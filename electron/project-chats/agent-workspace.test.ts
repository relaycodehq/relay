import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProjectChat } from "../../shared/projects";
import { agentWorktreeUnavailable } from "../../shared/projects";
import type { ChatCore } from "./core";
import { ThreadWorktrees } from "./worktrees";
import { TurnFiles } from "./turn-files";
import { threadControl } from "./control";
import * as gitApi from "../git/git";
import { gitIn } from "../../tests/fixtures/git-repo";

let temp: string,
  root: string,
  recovered: string,
  chat: ProjectChat,
  worktrees: ThreadWorktrees;
let core: ChatCore;
const git = (...args: string[]) => gitIn(root, ...args);
const save = vi.fn();
beforeEach(async () => {
  temp = await realpath(
    await mkdtemp(join(tmpdir(), "relay-agent-workspace-")),
  );
  root = join(temp, "repo");
  recovered = join(temp, "recovered");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "Initial",
  );
  const original = join(temp, "original");
  git("worktree", "add", "-q", "-b", "feature", original);
  await rename(original, recovered);
  git("worktree", "repair", recovered);
  chat = {
    id: "chat",
    projectId: "project",
    title: "Worktree",
    scope: { kind: "project" },
    created: 1,
    updated: 1,
    activeAgentWorktree: {
      path: original,
      gitdir: "original",
      branch: "feature",
    },
    messages: [
      {
        id: "answer",
        role: "assistant",
        body: "Working",
        provider: "codex",
        status: "complete",
        version: 1,
        created: 1,
        trace: [
          {
            kind: "activity",
            id: "add",
            activity: {
              id: "add",
              kind: "command",
              label: `git worktree add -b feature ${original}`,
              status: "complete",
            },
          },
        ],
      },
    ],
  };
  save.mockReset();
  core = {
    // A project on this computer: its checkout is here.
    projects: { root: vi.fn(async () => root), get: () => ({}) },
    storage: { load: vi.fn(async () => chat), save },
    store: { get: () => ({ chats: [chat] }) },
    active: {
      has: vi.fn(() => true),
      hasSide: vi.fn(() => false),
      finished: vi.fn(async () => {}),
    },
    sessions: { pending: vi.fn(() => []), close: vi.fn() },
    control: threadControl(),
  } as unknown as ChatCore;
  worktrees = new ThreadWorktrees(core, join(temp, "relay-worktrees"), {
    busy: () => false,
    root: async () => undefined,
  });
});
afterEach(async () => rm(temp, { recursive: true, force: true }));

it("uses the recovered folder for agents, workspace APIs and the terminal, and keeps it out of checkout activity", async () => {
  expect(await worktrees.root(chat)).toBe(recovered);
  expect(await worktrees.rootFor("project", "chat")).toBe(recovered);
  expect(await worktrees.terminalFolder("project", "chat")).toBe(recovered);
  expect(await worktrees.agents.worksInCheckout("project", "chat")).toBe(false);
  expect(worktrees.checkoutBusy("project")).toBe(false);
  expect(worktrees.folders("project")).toEqual([
    { path: recovered, chatId: "chat" },
  ]);
  expect(save).toHaveBeenCalledTimes(1);
});

it("shares discovery for concurrent thread reads and refreshes after repository mutations", async () => {
  const other = structuredClone(chat);
  other.id = "other";
  delete other.activeAgentWorktree;
  other.messages = [];
  other.agentWorktrees = [{ path: recovered, gitdir: "original", at: 1 }];
  const scans = vi.spyOn(gitApi, "worktreeList");
  try {
    await Promise.all([
      worktrees.agents.refresh(chat),
      worktrees.agents.refresh(other),
    ]);
    expect(scans).toHaveBeenCalledTimes(1);
    expect(chat.activeAgentWorktree?.path).toBe(recovered);
    expect(other.activeAgentWorktree).toBeUndefined();
    await worktrees.inRepo(root, async () => {
      git("worktree", "remove", recovered);
    });
    await worktrees.agents.refresh(chat);
    expect(scans).toHaveBeenCalledTimes(2);
    expect(chat.agentWorktrees).toBeUndefined();
    // Explicitly selected identity remains unavailable rather than moving to checkout.
    expect(chat.activeAgentWorktree?.gitdir).toBe("original");
  } finally {
    scans.mockRestore();
  }
});

it("keeps PR metadata on the agent's worktree without making Relay own its cleanup", async () => {
  await worktrees.agents.refresh(chat);
  const pr = { number: 7, url: "https://example.invalid/pull/7" };
  await worktrees.recordPull("chat", pr);
  expect(chat.agentWorktrees?.[0].pr).toEqual(pr);
  expect(chat.worktree).toBeUndefined();
});

it("resolves files linked from turns against the same recovered worktree", async () => {
  chat.messages[0].changes = [
    { path: "feature.txt", additions: 1, deletions: 0, binary: false },
  ];
  const files = new TurnFiles(core, worktrees);
  expect(await files.path("chat", "answer", "feature.txt")).toBe(
    join(recovered, "feature.txt"),
  );
  expect(await files.path("chat", null, "feature.txt")).toBe(
    join(recovered, "feature.txt"),
  );
  await expect(files.path("chat", "answer", "unrelated.txt")).rejects.toThrow(
    "didn't change",
  );
});

it("rejects another project's thread and a removed folder instead of running workspace actions on main", async () => {
  await expect(worktrees.rootFor("other", "chat")).rejects.toThrow(
    "another project",
  );
  await expect(worktrees.terminalFolder("other", "chat")).rejects.toThrow(
    "another project",
  );
  await worktrees.agents.refresh(chat);
  git("worktree", "remove", recovered);
  await expect(worktrees.rootFor("project", "chat")).rejects.toThrow(
    "unavailable",
  );
  await expect(worktrees.terminalFolder("project", "chat")).rejects.toThrow(
    "unavailable",
  );
});

const resolvers = {
  agent: () => worktrees.root(chat),
  workspace: () => worktrees.rootFor("project", "chat", "original"),
  terminal: () => worktrees.terminalFolder("project", "chat"),
};

it.each(Object.keys(resolvers) as (keyof typeof resolvers)[])(
  "%s resolution publishes an external deletion inside the discovery cache window",
  async (resolver) => {
    const scans = vi.spyOn(gitApi, "worktreeList");
    try {
      await worktrees.agents.refresh(chat);
      const selected = structuredClone(chat.activeAgentWorktree);
      git("worktree", "remove", recovered);
      // No inRepo invalidation and no five-second wait: the stale selected
      // folder must trigger discovery and publish the unavailable summary.
      await expect(resolvers[resolver]()).rejects.toThrow("unavailable");
      expect(agentWorktreeUnavailable(chat)).toBe(true);
      expect(chat.activeAgentWorktree).toEqual(selected);
      expect(save).toHaveBeenCalledTimes(2);
      expect(scans).toHaveBeenCalledTimes(2);
      await expect(resolvers[resolver]()).rejects.toThrow("unavailable");
      expect(scans).toHaveBeenCalledTimes(2);
    } finally {
      scans.mockRestore();
    }
  },
);

it.each(Object.keys(resolvers) as (keyof typeof resolvers)[])(
  "%s resolution follows an externally repaired move inside the discovery cache window",
  async (resolver) => {
    await worktrees.agents.refresh(chat);
    const moved = join(temp, "moved-again");
    await rename(recovered, moved);
    git("worktree", "repair", moved);
    expect(await resolvers[resolver]()).toBe(moved);
    expect(chat.activeAgentWorktree).toMatchObject({
      path: moved,
      gitdir: "original",
    });
    expect(agentWorktreeUnavailable(chat)).toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
  },
);

it("keeps discovered worktrees inactive until selected, and keeps that selection when another is discovered", async () => {
  delete chat.activeAgentWorktree;
  vi.mocked(core.active.has).mockReturnValue(false);
  expect(await worktrees.root(chat)).toBe(root);
  expect(await worktrees.terminalFolder("project", "chat")).toBe(root);
  expect(chat.agentWorktrees).toHaveLength(1);
  expect(chat.activeAgentWorktree).toBeUndefined();
  await worktrees.agents.select("chat", recovered);
  expect(chat.activeAgentWorktree).toMatchObject({
    path: recovered,
    gitdir: "original",
  });
  expect(await worktrees.rootFor("project", "chat", "original")).toBe(
    recovered,
  );
  const newer = join(temp, "newer");
  git("worktree", "add", "-q", "-b", "newer", newer);
  chat.messages.push({
    ...chat.messages[0],
    id: "newer-answer",
    created: 2,
    trace: [
      {
        kind: "activity",
        id: "newer-add",
        activity: {
          id: "newer-add",
          kind: "command",
          status: "complete",
          label: `git worktree add -b newer ${newer}`,
        },
      },
    ],
  });
  await worktrees.agents.refresh(chat, true);
  expect(chat.agentWorktrees).toHaveLength(2);
  expect(await worktrees.root(chat)).toBe(recovered);
  await worktrees.agents.select("chat", newer);
  expect(await worktrees.root(chat)).toBe(newer);
  await expect(
    worktrees.rootFor("project", "chat", "original"),
  ).rejects.toThrow("workspace changed");
  await worktrees.agents.select("chat", null);
  expect(await worktrees.root(chat)).toBe(root);
  expect(chat.agentWorktrees).toHaveLength(2);
  await expect(worktrees.rootFor("project", "chat", "newer")).rejects.toThrow(
    "workspace changed",
  );
  expect(core.sessions.close).toHaveBeenCalledTimes(3);
  expect(chat.movedIn).toMatchObject({ from: newer, to: root, selected: true });
});

it("keeps the selected identity after a repaired move, and blocks on removal until another explicit choice", async () => {
  vi.mocked(core.active.has).mockReturnValue(false);
  await worktrees.agents.refresh(chat);
  const moved = join(temp, "moved-again");
  await rename(recovered, moved);
  git("worktree", "repair", moved);
  await worktrees.agents.refresh(chat, true);
  expect(chat.activeAgentWorktree).toMatchObject({
    path: moved,
    gitdir: "original",
  });
  expect(await worktrees.rootFor("project", "chat", "original")).toBe(moved);
  git("worktree", "remove", moved);
  await worktrees.agents.refresh(chat, true);
  expect(chat.agentWorktrees).toBeUndefined();
  expect(chat.activeAgentWorktree?.path).toBe(moved);
  await expect(worktrees.root(chat)).rejects.toThrow("unavailable");
  await expect(
    worktrees.rootFor("project", "chat", "original"),
  ).rejects.toThrow("unavailable");
  await expect(worktrees.terminalFolder("project", "chat")).rejects.toThrow(
    "unavailable",
  );
  await worktrees.agents.select("chat", null);
  expect(await worktrees.root(chat)).toBe(root);
});

it("rejects unowned paths, running or background turns, and managed worktrees", async () => {
  await expect(worktrees.agents.select("chat", recovered)).rejects.toThrow(
    "Wait for the answer",
  );
  vi.mocked(core.active.has).mockReturnValue(false);
  vi.mocked(core.active.hasSide).mockReturnValue(true);
  await expect(worktrees.agents.select("chat", recovered)).rejects.toThrow(
    "Wait for the answer",
  );
  vi.mocked(core.active.hasSide).mockReturnValue(false);
  chat.heldWakeups = [{ id: "wake", prompt: "continue", at: 123 }];
  await expect(worktrees.agents.select("chat", recovered)).rejects.toThrow(
    "background work",
  );
  delete chat.heldWakeups;
  await expect(
    worktrees.agents.select("chat", join(temp, "unrelated")),
  ).rejects.toThrow("didn't make");
  chat.worktree = { path: recovered };
  await expect(worktrees.agents.select("chat", null)).rejects.toThrow(
    "Only project-folder threads",
  );
});

it("makes a deleted worktree again from its branch, and can't once the branch went too", async () => {
  vi.mocked(core.active.has).mockReturnValue(false);
  await worktrees.agents.refresh(chat);
  git("worktree", "remove", recovered);
  await worktrees.agents.refresh(chat, true);
  expect(await worktrees.agents.recreatable("chat")).toBe(true);
  await worktrees.agents.recreate("chat");
  await worktrees.agents.refresh(chat, true);
  expect(await worktrees.root(chat)).toBe(recovered);
  expect(
    execFileSync("git", ["-C", recovered, "branch", "--show-current"])
      .toString()
      .trim(),
  ).toBe("feature");
  git("worktree", "remove", recovered);
  git("branch", "-D", "feature");
  await worktrees.agents.refresh(chat, true);
  expect(await worktrees.agents.recreatable("chat")).toBe(false);
  await expect(worktrees.agents.recreate("chat")).rejects.toThrow(
    "deleted too",
  );
});
