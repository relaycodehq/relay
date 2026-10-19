import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { ThreadWorktrees } from "./worktrees";

// A Git run from inside another repository's hook or bisect would act on that one.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

let temp: string;
let root: string;
let worktrees: ThreadWorktrees;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

const thread = (worktree: ProjectChat["worktree"]): ProjectChat => ({
  id: "chat",
  projectId: "project",
  title: "fix the login thing",
  scope: { kind: "project" },
  created: 1,
  updated: 1,
  messages: [],
  worktree,
});

beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "relay-naming-")));
  root = join(temp, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(
    root,
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
  const core = {
    projects: { root: vi.fn(async () => root) },
    storage: { save: vi.fn() },
    active: { has: () => true },
  } as unknown as ChatCore;
  worktrees = new ThreadWorktrees(core, join(temp, "worktrees"), {
    busy: () => false,
    root: async () => undefined,
  });
});
afterEach(() => rm(temp, { recursive: true, force: true }));

it("waits for the title when Relay picked the name, then moves to it", async () => {
  const chat = thread({});
  await worktrees.root(chat, "fix the login thing");
  expect(worktrees.unnamed.has("chat")).toBe(true);

  chat.title = "Repair login redirect";
  const path = await worktrees.named(chat);
  expect(basename(path!)).toBe("repair-login-redirect");
  expect(git(path!, "branch", "--show-current")).toBe(
    "relay/repair-login-redirect",
  );
  expect(worktrees.unnamed.has("chat")).toBe(false);
});

it("doesn't wait when the user named the branch", async () => {
  const chat = thread({ named: "team/login" });
  const path = await worktrees.root(chat, "fix the login thing");
  expect(worktrees.unnamed.has("chat")).toBe(false);

  chat.title = "Repair login redirect";
  expect(await worktrees.named(chat)).toBe(path);
  expect(git(path, "branch", "--show-current")).toBe("team/login");
});

it("waits for a carried-on branch that's checked out elsewhere rather than swapping it", async () => {
  git(root, "branch", "old-work");
  const chat = thread({ startFrom: { on: "old-work" } });
  const path = await worktrees.root(chat, "carry on");
  expect(chat.worktree).toMatchObject({ branch: "old-work", existing: true });
  git(root, "worktree", "remove", "--force", path);
  git(root, "switch", "-q", "old-work");

  await expect(worktrees.root(chat, "again")).rejects.toThrow(
    /Couldn't open old-work in a worktree again: old-work is checked out in /,
  );
  expect(chat.worktree?.branch).toBe("old-work");

  git(root, "switch", "-q", "main");
  expect(await worktrees.root(chat, "again")).toBe(path);
  expect(git(path, "branch", "--show-current")).toBe("old-work");
});

it("gives a carried-on branch deleted meanwhile a branch of its own", async () => {
  git(root, "branch", "old-work");
  const chat = thread({ startFrom: { on: "old-work" } });
  const path = await worktrees.root(chat, "carry on");
  git(root, "worktree", "remove", "--force", path);
  git(root, "branch", "-D", "old-work");

  await worktrees.root(chat, "again");
  expect(chat.worktree?.branch).toMatch(/^relay\//);
  expect(chat.worktree?.existing).toBeUndefined();
  expect(chat.worktree?.named).toBeUndefined();
});
