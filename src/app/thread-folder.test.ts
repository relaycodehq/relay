import { describe, expect, it } from "vitest";
import type { ChatSummary, ChatWorktree } from "../../shared/projects";
import { terminalBlocked, worktreeThread } from "./thread-folder";

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
