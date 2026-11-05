import { expect, it, vi } from "vitest";
import { parseWorktreeList } from "./git";

// Git for Windows lists folders with forward slashes; Relay's paths have backslashes.
vi.mock("node:path", async () => (await vi.importActual("node:path")).win32);

it("lists worktrees by their Windows paths", () => {
  const out = [
    "worktree C:/Users/bob/relay\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main",
    "worktree C:/Users/bob/relay/.claude/worktrees/fix\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/fix",
    "worktree C:/Users/bob/gone\nHEAD 3333333333333333333333333333333333333333\ndetached\nprunable gitdir file points to non-existent location",
    "",
  ].join("\n\n");
  expect(parseWorktreeList(out)).toEqual([
    { path: "C:\\Users\\bob\\relay", branch: "main", prunable: false },
    {
      path: "C:\\Users\\bob\\relay\\.claude\\worktrees\\fix",
      branch: "fix",
      prunable: false,
    },
    { path: "C:\\Users\\bob\\gone", prunable: true },
  ]);
});
