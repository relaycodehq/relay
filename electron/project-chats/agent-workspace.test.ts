import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { ThreadWorktrees } from "./worktrees";
import { TurnFiles } from "./turn-files";
import { threadControl } from "./control";

let temp: string,
  root: string,
  recovered: string,
  chat: ProjectChat,
  worktrees: ThreadWorktrees;
let core: ChatCore;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
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
    projects: { root: vi.fn(async () => root) },
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
  });
});
afterEach(async () => rm(temp, { recursive: true, force: true }));

it("uses the recovered folder for agents, workspace APIs and the terminal, and keeps it out of checkout activity", async () => {
  expect(await worktrees.root(chat)).toBe(recovered);
  expect(await worktrees.rootFor("project", "chat")).toBe(recovered);
  expect(await worktrees.terminalFolder("project", "chat")).toBe(recovered);
  expect(await worktrees.worksInCheckout("project", "chat")).toBe(false);
  expect(worktrees.checkoutBusy("project")).toBe(false);
  expect(worktrees.folders("project")).toEqual([
    { path: recovered, chatId: "chat" },
  ]);
  expect(save).toHaveBeenCalledTimes(1);
});

it("keeps PR metadata on the agent's worktree without making Relay own its cleanup", async () => {
  await worktrees.refreshAgentWorktrees(chat);
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
  await worktrees.refreshAgentWorktrees(chat);
  git("worktree", "remove", recovered);
  await expect(worktrees.rootFor("project", "chat")).rejects.toThrow(
    "unavailable",
  );
  await expect(worktrees.terminalFolder("project", "chat")).rejects.toThrow(
    "unavailable",
  );
});

it("keeps discovered worktrees inactive until selected, and keeps that selection when another is discovered", async () => {
  delete chat.activeAgentWorktree;
  vi.mocked(core.active.has).mockReturnValue(false);
  expect(await worktrees.root(chat)).toBe(root);
  expect(await worktrees.terminalFolder("project", "chat")).toBe(root);
  expect(chat.agentWorktrees).toHaveLength(1);
  expect(chat.activeAgentWorktree).toBeUndefined();
  await worktrees.selectAgentWorktree("chat", recovered);
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
  await worktrees.refreshAgentWorktrees(chat, true);
  expect(chat.agentWorktrees).toHaveLength(2);
  expect(await worktrees.root(chat)).toBe(recovered);
  await worktrees.selectAgentWorktree("chat", newer);
  expect(await worktrees.root(chat)).toBe(newer);
  await expect(
    worktrees.rootFor("project", "chat", "original"),
  ).rejects.toThrow("workspace changed");
  await worktrees.selectAgentWorktree("chat", null);
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
  await worktrees.refreshAgentWorktrees(chat);
  const moved = join(temp, "moved-again");
  await rename(recovered, moved);
  git("worktree", "repair", moved);
  await worktrees.refreshAgentWorktrees(chat, true);
  expect(chat.activeAgentWorktree).toMatchObject({
    path: moved,
    gitdir: "original",
  });
  expect(await worktrees.rootFor("project", "chat", "original")).toBe(moved);
  git("worktree", "remove", moved);
  await worktrees.refreshAgentWorktrees(chat, true);
  expect(chat.agentWorktrees).toBeUndefined();
  expect(chat.activeAgentWorktree?.path).toBe(moved);
  await expect(worktrees.root(chat)).rejects.toThrow("unavailable");
  await expect(
    worktrees.rootFor("project", "chat", "original"),
  ).rejects.toThrow("unavailable");
  await expect(worktrees.terminalFolder("project", "chat")).rejects.toThrow(
    "unavailable",
  );
  await worktrees.selectAgentWorktree("chat", null);
  expect(await worktrees.root(chat)).toBe(root);
});

it("rejects unowned paths, running or background turns, and managed worktrees", async () => {
  await expect(
    worktrees.selectAgentWorktree("chat", recovered),
  ).rejects.toThrow("Wait for the answer");
  vi.mocked(core.active.has).mockReturnValue(false);
  vi.mocked(core.active.hasSide).mockReturnValue(true);
  await expect(
    worktrees.selectAgentWorktree("chat", recovered),
  ).rejects.toThrow("Wait for the answer");
  vi.mocked(core.active.hasSide).mockReturnValue(false);
  chat.heldWakeups = [{ id: "wake", prompt: "continue", at: 123 }];
  await expect(
    worktrees.selectAgentWorktree("chat", recovered),
  ).rejects.toThrow("background work");
  delete chat.heldWakeups;
  await expect(
    worktrees.selectAgentWorktree("chat", join(temp, "unrelated")),
  ).rejects.toThrow("didn't make");
  chat.worktree = { path: recovered };
  await expect(worktrees.selectAgentWorktree("chat", null)).rejects.toThrow(
    "Only project-folder threads",
  );
});
