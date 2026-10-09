import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addsWorktree,
  ownAgentWorktrees,
  watchAgentWorktrees,
  recoverAgentWorktrees,
  turnWorkspace,
} from "./agent-worktrees";
import { gitExecutable } from "../git/git";
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
function thread(relayMade: string[] = []) {
  const own = { worktrees: [] as AgentWorktree[] };
  const watch = watchAgentWorktrees(
    root,
    () => new Set(relayMade),
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

// Relay finds Git at startup, so a watcher's first look starts Git at once.
beforeAll(() => gitExecutable());
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
  expect(t.worktrees).toEqual([
    { path: a, gitdir: "wt-a", at: expect.any(Number) },
  ]);
});

it("keeps ownership when git repairs a worktree at a different path", async () => {
  const t = thread();
  const original = join(temp, "original");
  const recovered = join(temp, "recovered");
  git("worktree", "add", "-q", "-b", "feature", original);
  await t.run(`git worktree add -b feature ${original}`);
  await rename(original, recovered);
  git("worktree", "repair", recovered);
  await t.run(`git worktree repair ${recovered}`);
  expect(t.worktrees).toEqual([
    {
      path: recovered,
      branch: "feature",
      gitdir: "original",
      at: expect.any(Number),
    },
  ]);
});

it("recovers an older chat's missing association from creation history and stable Git identity", async () => {
  const original = join(temp, "old-temp-folder");
  const recovered = join(temp, "local-urls");
  const other = join(temp, "another-chat");
  git("worktree", "add", "-q", "-b", "local-urls", original);
  git("worktree", "add", "-q", "-b", "other", other);
  await rename(original, recovered);
  git("worktree", "repair", recovered);
  const chat = {
    messages: [
      {
        created: 42,
        trace: [
          {
            kind: "activity",
            activity: ran(`git worktree add -b local-urls ${original}`),
          },
        ],
      },
    ],
  } as unknown as ProjectChat;
  expect(await recoverAgentWorktrees(root, new Set(), chat)).toEqual([
    {
      path: recovered,
      branch: "local-urls",
      gitdir: "old-temp-folder",
      at: 42,
    },
  ]);
  chat.agentWorktrees = await recoverAgentWorktrees(root, new Set(), chat);
  expect(ownAgentWorktrees(chat)).toEqual(chat.agentWorktrees);
  git("worktree", "remove", recovered);
  expect(await recoverAgentWorktrees(root, new Set(), chat)).toEqual([]);
});

it("doesn't lose ownership when another thread notices a worktree before its creation event arrives", async () => {
  const t = thread();
  const path = join(temp, "own");
  git("worktree", "add", "-q", "-b", "own", path);
  await t.run("git worktree list");
  expect(t.paths()).toEqual([]);
  await t.run(`git worktree add -b own ${path}`);
  expect(t.paths()).toEqual([path]);
});

it("doesn't credit an attempted add of another chat's existing worktree", async () => {
  const path = join(temp, "already-owned");
  git("worktree", "add", "-q", "-b", "other", path);
  const t = thread();
  await t.run(`git worktree add -b mine ${path}`);
  expect(t.paths()).toEqual([]);
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
  expect(addsWorktree("rg 'worktree add' /tmp/relay-audit", path)).toBe(false);
  expect(
    addsWorktree("git worktree add -b relay-audit /tmp/other main", path),
  ).toBe(false);
  expect(
    addsWorktree("git worktree add /tmp/other; ls /tmp/relay-audit", path),
  ).toBe(false);
  expect(addsWorktree("ls /tmp/relay-audit; git worktree list", path)).toBe(
    false,
  );
});

it("follows the folder through a shell variable the command set", () => {
  const path = "/Users/me/Library/Relay/worktrees/relay/acp-agents";
  const made = (add: string) =>
    addsWorktree(
      `git log -3; WT="$HOME/Library/Relay/worktrees/relay/acp-agents"; ${add} && cd "$WT"`,
      path,
    );
  expect(made('git worktree add -b relay/acp-agents "$WT" main')).toBe(true);
  expect(made("git worktree add ${WT}")).toBe(true);
  // Single quotes keep the shell from expanding it.
  expect(made("git worktree add '$WT'")).toBe(false);
  expect(
    addsWorktree(
      "WT=/tmp/other; git worktree add $WT; ls /tmp/acp-agents",
      path,
    ),
  ).toBe(false);
});

it("credits a worktree an agent made in Relay's worktrees folder, but never a thread's own", async () => {
  const folder = join(temp, "relay-worktrees", "project");
  const mine = join(folder, "acp-agents");
  const relays = join(folder, "other-thread");
  git("worktree", "add", "-q", "-b", "relay/other-thread", relays);
  const t = thread([relays]);
  git("worktree", "add", "-q", "-b", "relay/acp-agents", mine);
  await t.run(`WT="${mine}"; git worktree add -b relay/acp-agents "$WT" main`);
  await t.run(`git worktree add -b relay/other-thread ${relays}`);
  expect(t.paths()).toEqual([mine]);
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

/** A project-folder thread's turn, wired as the turn runner wires it. */
function projectTurn(chat = { scope: { kind: "project" }, messages: [] }) {
  const thread = chat as unknown as ProjectChat;
  const watch = watchAgentWorktrees(
    root,
    () => new Set(),
    () => thread.agentWorktrees ?? [],
    turnWorkspace(thread),
  );
  return { thread, run: (label: string) => watch(ran(label)) };
}

it("moves the thread into the first worktree its agent makes, not later ones", async () => {
  const { thread, run } = projectTurn();
  const made = join(temp, "file-mentions");
  const later = join(temp, "later");
  git("worktree", "add", "-q", "-b", "file-mentions", made);
  await run(`git worktree add -b file-mentions ${made}`);
  expect(thread.activeAgentWorktree?.path).toBe(made);
  git("worktree", "add", "-q", "-b", "later", later);
  await run(`git worktree add -b later ${later}`);
  expect(thread.agentWorktrees).toHaveLength(2);
  expect(thread.activeAgentWorktree?.path).toBe(made);
});

it("leaves the project folder alone once the user went back to it", async () => {
  const { thread, run } = projectTurn();
  const made = join(temp, "file-mentions");
  git("worktree", "add", "-q", "-b", "file-mentions", made);
  await run(`git worktree add -b file-mentions ${made}`);
  delete thread.activeAgentWorktree;
  const later = join(temp, "later");
  git("worktree", "add", "-q", "-b", "later", later);
  await run(`git worktree add -b later ${later}`);
  expect(thread.agentWorktrees).toHaveLength(2);
  expect(thread.activeAgentWorktree).toBeUndefined();
});

it("goes back to the project folder when the turn removes the worktree it moved into", async () => {
  const { thread, run } = projectTurn();
  const made = join(temp, "scratch");
  git("worktree", "add", "-q", "-b", "scratch", made);
  await run(`git worktree add -b scratch ${made}`);
  expect(thread.activeAgentWorktree?.path).toBe(made);
  git("worktree", "remove", made);
  await run(`git worktree remove ${made}`);
  expect(thread.agentWorktrees).toBeUndefined();
  expect(thread.activeAgentWorktree).toBeUndefined();
});

it("keeps a worktree the user chose selected, as unavailable, when a turn removes it", async () => {
  const chosen = join(temp, "chosen");
  git("worktree", "add", "-q", "-b", "chosen", chosen);
  const [recorded] = await recoverAgentWorktrees(root, new Set(), {
    messages: [
      {
        trace: [
          {
            kind: "activity",
            id: "1",
            activity: ran(`git worktree add -b chosen ${chosen}`),
          },
        ],
      },
    ],
  } as unknown as ProjectChat);
  const active = { path: chosen, gitdir: recorded.gitdir, branch: "chosen" };
  const { thread, run } = projectTurn({
    scope: { kind: "project" },
    messages: [],
    agentWorktrees: [recorded],
    activeAgentWorktree: active,
  } as never);
  git("worktree", "remove", chosen);
  await run(`git worktree remove ${chosen}`);
  expect(thread.agentWorktrees).toBeUndefined();
  expect(thread.activeAgentWorktree).toEqual(active);
});
