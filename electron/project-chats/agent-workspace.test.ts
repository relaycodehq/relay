import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { ThreadWorktrees } from "./worktrees";
import { TurnFiles } from "./turn-files";

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
    active: { has: () => true },
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
  await expect(worktrees.rootFor("project", "chat")).rejects.toThrow("removed");
  await expect(worktrees.terminalFolder("project", "chat")).rejects.toThrow(
    "removed",
  );
});
