import { expect, it } from "vitest";
import { shownWorkspaceMoves } from "./workspace-moves";
import type { WorkspaceMove } from "./projects";

const move = (
  at: number,
  after: string,
  to?: string,
  how: WorkspaceMove["how"] = "switched",
): WorkspaceMove => ({ at, after, how, ...(to ? { to } : {}), unasked: true });

const shown = (moves: WorkspaceMove[]) =>
  shownWorkspaceMoves(moves).map((m) => m.at);

it("shows nothing for a worktree the agent made and removed under one message", () => {
  expect(shown([move(1, "ask", "/wt/scratch"), move(2, "ask")])).toEqual([]);
});

it("shows only where the thread ended up when it moved twice under one message", () => {
  expect(shown([move(1, "ask", "/wt/a"), move(2, "ask", "/wt/b")])).toEqual([
    2,
  ]);
});

it("keeps a round trip that spans messages, one line under each", () => {
  expect(shown([move(1, "ask", "/wt/a"), move(2, "answer")])).toEqual([1, 2]);
});

it("keeps a recreated worktree even though the folder is the same", () => {
  expect(
    shown([move(1, "ask", "/wt/a"), move(2, "later", "/wt/a", "recreated")]),
  ).toEqual([1, 2]);
});

it("ends for moves made before the thread had a message", () => {
  const early: WorkspaceMove = { at: 1, how: "moved", to: "/wt/a", unasked: true };
  expect(shownWorkspaceMoves([early]).map((m) => m.at)).toEqual([1]);
});

it("shows a worktree switched to another branch in the folder it was already in", () => {
  const joined = { ...move(1, "ask", "/wt/panel"), branch: "panel" };
  const switched = { ...move(2, "next", "/wt/panel"), branch: "feature" };
  expect(shown([joined, switched])).toEqual([1, 2]);
});
