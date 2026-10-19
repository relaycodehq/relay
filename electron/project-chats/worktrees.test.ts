import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { joinedWorktree, type ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { ThreadWorktrees } from "./worktrees";

// A Git run from inside another repository's hook or bisect would act on that one.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

let temp: string;
let root: string;
let worktrees: ThreadWorktrees;
/** The threads the store has, which sharing a worktree is checked against. */
let chats: ProjectChat[];
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
  chats = [];
  const core = {
    projects: { root: vi.fn(async () => root) },
    storage: {
      save: vi.fn(),
      load: vi.fn(async (id: string) => chats.find((c) => c.id === id)!),
    },
    active: { has: () => true, assertIdle: async () => {} },
    store: { get: () => ({ chats }) },
    control: (_id: string, run: () => unknown) => run(),
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
  git(root, "branch", "relay/old-work");
  const chat = thread({ startFrom: { on: "relay/old-work" } });
  const path = await worktrees.root(chat, "carry on");
  git(root, "worktree", "remove", "--force", path);
  git(root, "branch", "-D", "relay/old-work");

  await worktrees.root(chat, "again");
  // Named after the thread, not remade under the lost branch's name.
  expect(chat.worktree?.branch).toMatch(/^relay\//);
  expect(chat.worktree?.branch).not.toBe("relay/old-work");
  expect(chat.worktree?.existing).toBeUndefined();
  expect(chat.worktree?.named).toBeUndefined();
});

it("opens a carried-on branch beside its old folder once another took it", async () => {
  git(root, "branch", "old-work");
  const chat = thread({ startFrom: { on: "old-work" } });
  const path = await worktrees.root(chat, "carry on");
  // Cleaned up when it settled, and the folder handed to another thread.
  git(root, "worktree", "remove", "--force", path);
  chat.worktree = { ...chat.worktree, removedAt: 1 };
  await mkdir(path);

  const again = await worktrees.root(chat, "again");
  expect(again).not.toBe(path);
  expect(git(again, "branch", "--show-current")).toBe("old-work");
  expect(chat.worktree).toMatchObject({ path: again, existing: true });
});

/** A second thread in `chat`'s worktree, as joining it from the Workspace menu makes one. */
const joining = (chat: ProjectChat): ProjectChat => ({
  ...thread(joinedWorktree(chat.worktree!)),
  id: "other",
  title: "write the tests",
});

it("keeps a shared worktree's folder and name when the first thread's title comes", async () => {
  const chat = thread({});
  const path = await worktrees.root(chat, "fix the login thing");
  chats = [chat, joining(chat)];

  chat.title = "Repair login redirect";
  expect(await worktrees.named(chat)).toBe(path);
  expect(existsSync(path)).toBe(true);
  expect(git(path, "branch", "--show-current")).toBe(chat.worktree!.branch);
});

it("won't remove or clean up a worktree another thread works in, and archiving one leaves it", async () => {
  const chat = thread({});
  const path = await worktrees.root(chat, "fix the login thing");
  const other = joining(chat);
  chats = [chat, other];

  await expect(worktrees.remove("chat")).rejects.toThrow(
    "“write the tests” works in this worktree too",
  );
  expect(await worktrees.cleanUp("chat", async () => undefined)).toBe(
    "another thread works in it",
  );
  // Nothing uncommitted: archived alone, its worktree would go.
  await worktrees.dropLanded(chat, 5);
  expect(existsSync(path)).toBe(true);
  expect(chat.worktree!.removedAt).toBeUndefined();

  // Once the other is archived, the folder is this thread's alone again.
  other.archivedAt = 6;
  await worktrees.dropLanded(chat, 7);
  expect(chat.worktree!.removedAt).toBe(7);
});
