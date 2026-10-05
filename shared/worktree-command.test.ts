import { expect, it } from "vitest";
import type { ChatMessage, WorktreeCommandRun } from "./projects";
import { setupCanRerun, worktreeCommandNote } from "./worktree-command";

const run = (more: Partial<WorktreeCommandRun> = {}): WorktreeCommandRun => ({
  kind: "setup",
  command: "npm ci",
  output: "",
  ...more,
});

it("says how a setup or teardown went", () => {
  expect(worktreeCommandNote(run(), "streaming")).toBe(
    "Setting up the worktree…",
  );
  expect(worktreeCommandNote(run({ exitCode: 0 }), "complete")).toBe(
    "Worktree set up",
  );
  expect(worktreeCommandNote(run({ exitCode: 3 }), "failed")).toBe(
    "Worktree setup failed (exit 3)",
  );
  // -1: the shell couldn't even start.
  expect(worktreeCommandNote(run({ exitCode: -1 }), "failed")).toBe(
    "Worktree setup failed",
  );
  expect(worktreeCommandNote(run({ stopped: "timeout" }), "failed")).toBe(
    "Worktree setup timed out",
  );
  expect(worktreeCommandNote(run({ stopped: "cancelled" }), "cancelled")).toBe(
    "Worktree setup stopped",
  );
  expect(
    worktreeCommandNote(run({ kind: "teardown", exitCode: 1 }), "failed"),
  ).toBe("Worktree teardown failed (exit 1)");
});

it("offers to run again only a setup that didn't get through", () => {
  const message = (
    status: ChatMessage["status"],
    kind: WorktreeCommandRun["kind"] = "setup",
  ) =>
    ({
      id: "m",
      role: "assistant",
      body: "",
      status,
      created: 0,
      provider: "claude",
      version: 1,
      worktreeCommand: run({ kind }),
    }) satisfies ChatMessage;
  expect(setupCanRerun(message("failed"))).toBe(true);
  expect(setupCanRerun(message("cancelled"))).toBe(true);
  expect(setupCanRerun(message("complete"))).toBe(false);
  expect(setupCanRerun(message("streaming"))).toBe(false);
  expect(setupCanRerun(message("failed", "teardown"))).toBe(false);
});
