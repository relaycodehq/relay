import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addsWorktree,
  ownAgentWorktrees,
  watchAgentWorktrees,
} from "../../electron/agent-worktrees";
import type {
  AgentActivity,
  AgentWorktree,
  ProjectChat,
} from "../../shared/projects";

let temp: string;
let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
const ran = (label: string): AgentActivity => ({
  id: label,
  kind: "command",
  label,
  status: "complete",
});

/** A thread's turn: its recorded worktrees and the watcher following its commands. */
function thread() {
  const own = { worktrees: [] as AgentWorktree[] };
  const watch = watchAgentWorktrees(
    root,
    join(temp, "relay-worktrees"),
    () => own.worktrees,
    (next) => {
      own.worktrees = next;
    },
  );
  return {
    run: (label: string) => watch(ran(label)),
    paths: () => own.worktrees.map((w) => w.path),
    get worktrees() {
      return own.worktrees;
    },
  };
}

beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "relay-agent-wt-")));
  root = join(temp, "project");
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
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

it("credits each worktree only to the thread whose command made it", async () => {
  const phone = thread();
  const audit = thread();
  const phonePath = join(temp, "relay-phone");
  const auditPath = join(temp, "relay-audit");

  const addPhone = `git worktree add -q -b phone-remote ${phonePath} HEAD`;
  git("worktree", "add", "-q", "-b", "phone-remote", phonePath, "HEAD");
  await phone.run(addPhone);
  // The other thread looks at the list while the first one's worktree is new.
  await audit.run("git status --short; git worktree list");

  const addAudit = `git worktree add -b code-audit ../relay-audit main`;
  git("worktree", "add", "-q", "-b", "code-audit", auditPath, "main");
  await audit.run(addAudit);
  await phone.run(`cd ${phonePath} && git worktree list`);

  expect(phone.paths()).toEqual([phonePath]);
  expect(audit.paths()).toEqual([auditPath]);
});

it("shows a kept worktree's branch as it is now and drops removed ones", async () => {
  const t = thread();
  const a = join(temp, "wt-a");
  const b = join(temp, "wt-b");
  git("worktree", "add", "-q", "-b", "a", a);
  git("worktree", "add", "-q", "-b", "b", b);
  await t.run(`git worktree add -b a ${a} && git worktree add -b b ${b}`);
  expect(t.worktrees.map((w) => w.branch)).toEqual(["a", "b"]);

  execFileSync("git", ["-C", a, "checkout", "-q", "--detach"]);
  git("worktree", "remove", b);
  await t.run(`git worktree remove ${b}`);
  expect(t.worktrees).toEqual([{ path: a, at: expect.any(Number) }]);
});

it("matches the folder however the command spelled the path", () => {
  const path = "/private/tmp/relay-audit";
  expect(
    addsWorktree("git worktree add -b x /tmp/relay-audit main", path),
  ).toBe(true);
  expect(addsWorktree("git -C repo worktree add ../relay-audit", path)).toBe(
    true,
  );
  expect(addsWorktree("git worktree add '/tmp/relay-audit'", path)).toBe(true);
  expect(addsWorktree("git worktree add /tmp/relay-audit-2", path)).toBe(false);
  expect(addsWorktree("ls /tmp/relay-audit; git worktree list", path)).toBe(
    false,
  );
});

it("drops worktrees older saves credited to the wrong thread", () => {
  const chat = {
    messages: [
      {
        trace: [
          {
            kind: "activity",
            id: "1",
            activity: ran(
              "git worktree add -b code-audit /tmp/relay-audit main",
            ),
          },
          { kind: "activity", id: "2", activity: ran("git worktree list") },
        ],
      },
    ],
    agentWorktrees: [
      { path: "/private/tmp/relay-phone", branch: "phone-remote", at: 1 },
      { path: "/private/tmp/relay-audit", branch: "code-audit", at: 2 },
    ],
  } as unknown as ProjectChat;
  expect(ownAgentWorktrees(chat).map((w) => w.path)).toEqual([
    "/private/tmp/relay-audit",
  ]);
});
