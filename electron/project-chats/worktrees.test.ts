import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { joinedWorktree, type ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { ThreadWorktrees, joinableOn } from "./worktrees";

// A Git run from inside another repository's hook or bisect would act on that one.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

let temp: string;
let root: string;
let worktrees: ThreadWorktrees;
/** The threads the store has, which sharing a worktree is checked against. */
let chats: ProjectChat[];
/** Asked for the repository right before a removal waits for its queue. */
let projectRoot: ReturnType<typeof vi.fn>;
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
  projectRoot = vi.fn(async () => root);
  const core = {
    projects: { root: projectRoot },
    storage: {
      save: vi.fn(),
      load: vi.fn(async (id: string) => chats.find((c) => c.id === id)!),
    },
    active: { has: () => true, assertIdle: async () => {} },
    store: { get: () => ({ chats }) },
    sessions: { close: vi.fn() },
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

it("carries a branch on wherever it's checked out by the time the thread comes back", async () => {
  git(root, "branch", "old-work");
  const chat = thread({ startFrom: { on: "old-work" } });
  const path = await worktrees.root(chat, "carry on");
  expect(chat.worktree).toMatchObject({ branch: "old-work", existing: true });
  git(root, "worktree", "remove", "--force", path);
  const theirs = join(temp, "their-checkout");
  git(root, "worktree", "add", "-q", theirs, "old-work");

  expect(await worktrees.root(chat, "again")).toBe(theirs);
  expect(chat.worktree).toMatchObject({ branch: "old-work", adopted: true });
  expect(chat.workspaceMoves?.at(-1)?.fresh).toBeUndefined();

  // In the project folder, where Git won't check it out twice: a branch off it.
  git(root, "worktree", "remove", "--force", theirs);
  git(root, "switch", "-q", "old-work");
  const fresh = await worktrees.root(chat, "and again");
  expect(git(fresh, "branch", "--show-current")).toMatch(/^relay\//);
  expect(chat.worktree).toMatchObject({ startedOff: "old-work" });
  expect(chat.workspaceMoves?.at(-1)?.fresh).toBe(true);
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

it("deletes an archived thread's worktree with work in it when asked, keeping its branch, but not one others share", async () => {
  const chat = thread({});
  const path = await worktrees.root(chat, "fix the login thing");
  chats = [chat];
  execFileSync("sh", ["-c", "echo draft > notes.txt"], { cwd: path });
  const other = joining(chat);
  chats = [chat, other];

  await worktrees.dropArchived(chat);
  expect(existsSync(path)).toBe(true);

  other.archivedAt = 6;
  await worktrees.dropArchived(chat);
  expect(existsSync(path)).toBe(false);
  expect(chat.worktree).toMatchObject({ cleanedUp: true });
  expect(git(root, "branch", "--list", chat.worktree!.branch!)).not.toBe("");
});

it("works in a folder it didn't make without ever removing it, and makes its own once that's gone", async () => {
  git(root, "branch", "feature");
  const theirs = join(temp, "their-checkout");
  git(root, "worktree", "add", "-q", theirs, "feature");
  const chat = thread({ startFrom: { on: "feature" } });
  const other: ProjectChat = {
    ...thread({ startFrom: { on: "feature" } }),
    id: "other",
    title: "write the tests",
  };
  chats = [chat, other];

  expect(await worktrees.root(chat, "carry on")).toBe(theirs);
  expect(chat.worktree).toMatchObject({ adopted: true, existing: true });
  // Two threads finding the same folder share it.
  expect(await worktrees.root(other, "carry on too")).toBe(theirs);
  chats = [chat];

  await expect(worktrees.remove("chat")).rejects.toThrow(
    "Relay didn't make this worktree",
  );
  expect(await worktrees.cleanUp("chat", async () => undefined)).toBe(
    "not a worktree Relay made",
  );
  chat.archivedAt = 5;
  await worktrees.dropLanded(chat, 5);
  await worktrees.dropArchived(chat);
  expect(existsSync(theirs)).toBe(true);
  expect(git(theirs, "branch", "--show-current")).toBe("feature");
  expect(chat.worktree?.removedAt).toBeUndefined();

  delete chat.archivedAt;
  git(root, "worktree", "remove", "--force", theirs);
  const own = await worktrees.root(chat, "again");
  expect(own.startsWith(join(temp, "worktrees"))).toBe(true);
  expect(git(own, "branch", "--show-current")).toBe("feature");
  expect(chat.worktree).toMatchObject({
    existing: true,
    named: "feature",
    setup: "pending",
  });
  expect(chat.worktree?.adopted).toBeUndefined();
  // Still on its branch, so not a fresh start.
  expect(chat.workspaceMoves).toEqual([
    expect.objectContaining({
      how: "recreated",
      to: own,
      branch: "feature",
      unasked: true,
    }),
  ]);
  expect(chat.workspaceMoves![0]!.fresh).toBeUndefined();
});

it("makes a branch kept for another thread's next message again, one folder for both", async () => {
  const away: ProjectChat = { ...thread({}), id: "away", title: "fix login" };
  chats = [away];
  const path = await worktrees.root(away, "fix the login thing");
  const branch = away.worktree!.branch!;
  expect(
    await worktrees.cleanUp("away", async () => undefined),
  ).toBeUndefined();
  expect(existsSync(path)).toBe(false);

  const chat = thread({ startFrom: { on: branch } });
  chats = [away, chat];
  const made = await worktrees.root(chat, "carry on");
  expect(git(made, "branch", "--show-current")).toBe(branch);
  expect(chat.worktree).toMatchObject({ branch, existing: true });
  expect(away.worktree).toMatchObject({ path: made, branch, setup: "done" });
  expect(away.worktree?.cleanedUp).toBeUndefined();
  expect(away.worktree?.removedAt).toBeUndefined();

  // Back, it works in the same folder, and neither can take it from the other.
  expect(await worktrees.root(away, "next")).toBe(made);
  await expect(worktrees.remove("chat")).rejects.toThrow(
    "“fix login” works in this worktree too",
  );
});

it("makes a shared folder removed by hand again for both threads rather than joining what's left of it", async () => {
  git(root, "branch", "feature");
  const theirs = join(temp, "their-checkout");
  git(root, "worktree", "add", "-q", theirs, "feature");
  const chat = thread({ startFrom: { on: "feature" } });
  const other: ProjectChat = {
    ...thread({ startFrom: { on: "feature" } }),
    id: "other",
    title: "write the tests",
  };
  chats = [chat, other];
  await worktrees.root(chat, "carry on");
  expect(await worktrees.root(other, "carry on too")).toBe(theirs);
  git(root, "worktree", "remove", "--force", theirs);

  const own = await worktrees.root(chat, "again");
  expect(existsSync(own)).toBe(true);
  expect(git(own, "branch", "--show-current")).toBe("feature");
  expect(other.worktree?.path).toBe(own);
  expect(await worktrees.root(other, "next")).toBe(own);
});

it("puts two threads starting on one branch at once in one folder", async () => {
  git(root, "branch", "feature");
  const chat = thread({ startFrom: { on: "feature" } });
  const other: ProjectChat = {
    ...thread({ startFrom: { on: "feature" } }),
    id: "other",
    title: "write the tests",
  };
  chats = [chat, other];

  const settled = await Promise.allSettled([
    worktrees.root(chat, "carry on"),
    worktrees.root(other, "carry on too"),
  ]);
  expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
  const path = chat.worktree!.path!;
  expect(other.worktree?.path).toBe(path);
  expect(existsSync(path)).toBe(true);
  expect(git(path, "branch", "--show-current")).toBe("feature");
});

it("lends a kept branch's folder without racing its own thread's next message", async () => {
  const kept: ProjectChat = { ...thread({}), id: "kept", title: "fix login" };
  chats = [kept];
  await worktrees.root(kept, "fix the login thing");
  const branch = kept.worktree!.branch!;
  await worktrees.cleanUp("kept", async () => undefined);
  const chat = thread({ startFrom: { on: branch } });
  chats = [kept, chat];

  const settled = await Promise.allSettled([
    worktrees.root(kept, "next"),
    worktrees.root(chat, "carry on"),
  ]);
  expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
  const path = chat.worktree!.path!;
  expect(kept.worktree).toMatchObject({ path, branch });
  expect(existsSync(path)).toBe(true);
  expect(git(path, "branch", "--show-current")).toBe(branch);
});

it("moves the threads sharing a folder onto the branch it's made again on, counting from where it does", async () => {
  git(root, "branch", "feature");
  const chat = thread({ startFrom: { on: "feature" } });
  const path = await worktrees.root(chat, "carry on");
  const other: ProjectChat = {
    ...thread(joinedWorktree(chat.worktree!)),
    id: "other",
    title: "write the tests",
  };
  chats = [chat, other];
  git(root, "worktree", "remove", "--force", path);
  // Only a branch off it now: the project folder has it checked out.
  git(root, "switch", "-q", "feature");

  const fresh = await worktrees.root(chat, "again");
  expect(chat.worktree).toMatchObject({ startedOff: "feature" });
  const {
    setup: _setup,
    portOffset: _offset,
    wanted: _wanted,
    ...made
  } = chat.worktree!;
  expect(other.worktree).toEqual({ ...made, setup: "done" });
  expect(other.worktree?.path).toBe(fresh);
  expect(other.worktree?.existing).toBeUndefined();
  expect(other.worktree?.named).toBeUndefined();
});

it("joins no away thread's folder, nor lends a returned copy's", async () => {
  const away: ProjectChat = { ...thread({}), id: "away", title: "fix login" };
  chats = [away];
  const theirs = await worktrees.root(away, "fix the login thing");
  away.sentTo = {
    id: "h",
    computerId: "c",
    computer: "thinkcenter",
    at: 1,
    state: "away",
  };
  const chat = thread({ startFrom: { on: away.worktree!.branch! } });
  chats = [away, chat];
  const path = await worktrees.root(chat, "carry on");
  expect(path).not.toBe(theirs);
  expect(chat.worktree).toMatchObject({
    startedOff: away.worktree!.branch,
    wanted: { branch: away.worktree!.branch },
  });
  expect(away.worktree?.path).toBe(theirs);

  const copy: ProjectChat = { ...thread({}), id: "copy", title: "old trip" };
  chats = [copy];
  const old = await worktrees.root(copy, "an earlier trip");
  await worktrees.cleanUp("copy", async () => undefined);
  copy.worktree!.removedAt = 5;
  copy.cameFrom = {
    id: "h",
    computer: "thinkcenter",
    deviceId: "d",
    at: 1,
    carried: 0,
    tip: copy.worktree!.head!,
    returnedAt: 5,
  };
  const next: ProjectChat = {
    ...thread({ startFrom: { on: copy.worktree!.branch! } }),
    id: "next",
  };
  chats = [copy, next];
  await worktrees.root(next, "carry on");
  expect(copy.worktree).toMatchObject({ path: old, removedAt: 5 });
});

it("fetches a remote start outside the repository's queue, so a slow remote holds up no other thread", async () => {
  const remote = join(temp, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "origin", "main:feature");
  git(root, "fetch", "-q", "origin");
  // The remote answers only once the gate opens, or gives up after 10s.
  const gate = join(temp, "gate");
  git(root, "remote", "set-url", "origin", "ssh://example.invalid/repo");
  vi.stubEnv(
    "GIT_SSH_COMMAND",
    `i=0; while [ ! -e '${gate}' ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done; false`,
  );
  try {
    const slow: ProjectChat = {
      ...thread({ startFrom: { off: "origin/feature" } }),
      id: "slow",
      title: "off the remote",
    };
    const other = thread({});
    chats = [slow, other];
    let fetched = false;
    const waiting = worktrees.root(slow, "off the remote").then((path) => {
      fetched = true;
      return path;
    });
    expect(existsSync(await worktrees.root(other, "meanwhile"))).toBe(true);
    expect(fetched).toBe(false);
    await mkdir(gate);
    expect(existsSync(await waiting)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
  }
});

/** A deep review that followed the branch it reviews into `path`, as the store lists it. */
const reviewIn = (path: string) =>
  ({
    ...thread(undefined),
    id: "review",
    title: "Deep review",
    reviewFolder: { path, branch: "feature" },
  }) as ProjectChat;

it("keeps a worktree a review followed its branch into, however its thread lets go of it", async () => {
  const chat = thread({});
  const path = await worktrees.root(chat, "fix the login thing");
  const review = reviewIn(path);
  chats = [chat, review];

  await expect(worktrees.remove("chat")).rejects.toThrow(
    "“Deep review” works in this worktree too",
  );
  expect(await worktrees.cleanUp("chat", async () => undefined)).toBe(
    "another thread works in it",
  );
  execFileSync("sh", ["-c", "echo fix > fix.txt"], { cwd: path });
  chat.archivedAt = 5;
  await worktrees.dropArchived(chat);
  expect(existsSync(join(path, "fix.txt"))).toBe(true);
  expect(chat.worktree!.removedAt).toBeUndefined();

  review.archivedAt = 6;
  await worktrees.dropArchived(chat);
  expect(existsSync(path)).toBe(false);
});

it("keeps a folder another thread joined while its removal waited for the repository", async () => {
  const chat = thread({});
  const path = await worktrees.root(chat, "fix the login thing");
  chat.archivedAt = 5;
  chats = [chat];
  let open!: () => void;
  const held = worktrees.inRepo(root, () => new Promise<void>((r) => (open = r)));
  projectRoot.mockClear();
  const dropping = worktrees.dropArchived(chat);
  // Torn down and waiting for the queue, where a new thread joins first.
  await vi.waitFor(() => expect(projectRoot).toHaveBeenCalled());
  chats.push(joining(chat));
  open();
  await held;
  await dropping;
  expect(existsSync(path)).toBe(true);
  expect(chat.worktree!.removedAt).toBeUndefined();
});

it("joins no folder its agent switched to another branch", async () => {
  git(root, "branch", "other");
  const chat = thread({});
  const path = await worktrees.root(chat, "fix the login thing");
  chats = [chat];
  const branch = chat.worktree!.branch!;
  expect(await joinableOn(root, chats, branch)).toBe(chat);

  git(path, "switch", "-q", "other");
  expect(await joinableOn(root, chats, branch)).toBeUndefined();
});

it("reads a remote branch picked to carry on as its local twin, so an away thread's folder stays its own", async () => {
  const remote = join(temp, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "origin", "main:feature");
  git(root, "fetch", "-q", "origin");
  git(root, "branch", "feature", "origin/feature");
  const away: ProjectChat = {
    ...thread({ startFrom: { on: "feature" } }),
    id: "away",
    title: "fix login",
  };
  chats = [away];
  const theirs = await worktrees.root(away, "carry on");
  expect(await joinableOn(root, chats, "origin/feature")).toBe(away);
  away.sentTo = {
    id: "h",
    computerId: "c",
    computer: "thinkcenter",
    at: 1,
    state: "away",
  };

  const chat = thread({ startFrom: { on: "origin/feature" } });
  chats = [away, chat];
  const path = await worktrees.root(chat, "carry on");
  expect(path).not.toBe(theirs);
  expect(chat.worktree?.adopted).toBeUndefined();
  expect(chat.worktree).toMatchObject({ wanted: { branch: "origin/feature" } });
});
