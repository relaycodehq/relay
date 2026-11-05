import { expect, it, vi } from "vitest";
import { addsWorktree } from "./agent-worktrees";

// Agents on Windows write folders with backslashes, in PowerShell or cmd.
vi.mock("node:path", async () => (await vi.importActual("node:path")).win32);

it("credits a worktree an agent added with a backslash path", () => {
  const path = "C:\\Users\\bob\\relay-audit";
  expect(addsWorktree("git worktree add ..\\relay-audit -b audit", path)).toBe(
    true,
  );
  expect(
    addsWorktree('git worktree add "C:\\Users\\bob\\relay-audit"', path),
  ).toBe(true);
  expect(addsWorktree("git worktree add ..\\relay-audit-2", path)).toBe(false);
});
