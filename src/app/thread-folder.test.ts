import { describe, expect, it } from "vitest";
import type { ChatSummary, ChatWorktree } from "../../shared/projects";
import {
  agentWorkingIn,
  terminalBlocked,
  worktreeThread,
} from "./thread-folder";

const thread = (worktree?: ChatWorktree): ChatSummary => ({
  id: "c1",
  projectId: "p1",
  title: "Thread",
  scope: { kind: "project" },
  created: 0,
  updated: 0,
  worktree,
});
const made = { path: "/tmp/wt", branch: "relay/wt" };

describe("worktreeThread", () => {
  it("follows the newest agent-created worktree, while a managed worktree takes priority", () => {
    const agent = {
      ...thread(),
      agentWorktrees: [{ path: "/tmp/agent", branch: "feature", at: 1 }],
    };
    expect(worktreeThread(agent)).toBe(agent);
    const managed = { ...agent, worktree: made };
    expect(worktreeThread(managed)).toBe(managed);
    expect(
      worktreeThread({ ...agent, worktree: { ...made, removedAt: 1 } }),
    ).toBeUndefined();
  });
  it("works in the checkout until the worktree is on disk, and again once it's removed", () => {
    expect(worktreeThread(undefined)).toBeUndefined();
    expect(worktreeThread(thread())).toBeUndefined();
    expect(worktreeThread(thread({}))).toBeUndefined();
    expect(worktreeThread(thread({ ...made, removedAt: 1 }))).toBeUndefined();
    const live = thread(made);
    expect(worktreeThread(live)).toBe(live);
  });
});

describe("terminalBlocked", () => {
  const project = { kind: "project" } as const;
  it("opens in a thread's checkout or its worktree on disk", () => {
    expect(terminalBlocked(thread(), project, "worktree")).toBeUndefined();
    expect(terminalBlocked(thread(made), project, "checkout")).toBeUndefined();
  });
  it("waits for a worktree thread's first message to make its folder", () => {
    expect(terminalBlocked(thread({}), project, "checkout")).toMatch(
      /first message makes/,
    );
    expect(terminalBlocked(undefined, project, "worktree")).toMatch(
      /first message makes/,
    );
  });
  it("says a removed worktree comes back with the next message", () => {
    expect(
      terminalBlocked(thread({ ...made, removedAt: 1 }), project, "checkout"),
    ).toMatch(/was removed/);
  });
  it("leaves an unsent PR or review thread in the checkout whatever the picker says", () => {
    const pr = {
      kind: "pr",
      ref: { owner: "o", name: "r", number: 1 },
    } as const;
    expect(terminalBlocked(undefined, pr, "worktree")).toBeUndefined();
    expect(terminalBlocked(undefined, project, "checkout")).toBeUndefined();
  });
});

describe("agentWorkingIn", () => {
  const running = (c: ChatSummary): ChatSummary => ({ ...c, running: true });
  const task = (c: ChatSummary): ChatSummary => ({
    ...c,
    pending: [
      { kind: "task", id: "t1", description: "Look", agent: true, since: 5 },
    ],
  });
  const own = { ...thread(made), id: "wt" };
  const other = {
    ...thread({ path: "/tmp/other", branch: "relay/other" }),
    id: "other",
  };

  it("counts the checkout's threads for the checkout, not a worktree's", () => {
    const chats = [running(thread()), own];
    expect(agentWorkingIn(chats, undefined)).toBe(true);
    expect(agentWorkingIn(chats, own)).toBe(false);
  });

  it("counts a worktree thread only for its own worktree", () => {
    const chats = [thread(), running(own)];
    expect(agentWorkingIn(chats, own)).toBe(true);
    expect(agentWorkingIn(chats, other)).toBe(false);
    expect(agentWorkingIn(chats, undefined)).toBe(false);
  });

  it("doesn't count an agent-created worktree's running thread against the main checkout", () => {
    const agent = {
      ...thread(),
      id: "agent",
      agentWorktrees: [{ path: "/tmp/agent", branch: "feature", at: 1 }],
    };
    expect(agentWorkingIn([running(agent)], undefined)).toBe(false);
    expect(agentWorkingIn([running(agent)], agent)).toBe(true);
  });

  it("counts background agents, and a removed worktree's thread as the checkout's", () => {
    expect(agentWorkingIn([task(own)], own)).toBe(true);
    const gone = running({ ...own, worktree: { ...made, removedAt: 1 } });
    expect(agentWorkingIn([gone], undefined)).toBe(true);
    expect(agentWorkingIn([gone], own)).toBe(false);
  });

  it("is quiet while nothing runs", () => {
    expect(agentWorkingIn([thread(), own], undefined)).toBe(false);
    expect(agentWorkingIn(undefined, undefined)).toBe(false);
  });
});
