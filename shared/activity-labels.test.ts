import { expect, it } from "vitest";
import { doneLabel, summarizeActivity } from "./activity-labels";
import type { AgentActivity } from "./projects";

const call = (
  id: string,
  kind: AgentActivity["kind"],
  status: AgentActivity["status"],
  label = id,
): AgentActivity => ({ id, kind, status, label });

it("counts failed attempts separately from completed work", () => {
  expect(
    summarizeActivity([
      call("stat", "command", "complete"),
      call("log", "command", "complete"),
      call("security", "agent", "failed"),
      call("ui", "agent", "failed"),
      call("links", "agent", "failed"),
    ]),
  ).toBe("Ran 2 commands and 3 tool calls failed");
  expect(summarizeActivity([call("diff", "read", "failed")])).toBe(
    "1 tool call failed",
  );
});

it("counts completed file reads once, without counting failed or running reads as success", () => {
  expect(
    summarizeActivity([
      call("read-1", "read", "failed", "src/app.ts"),
      call("read-2", "read", "complete", "src/app.ts"),
      call("read-3", "read", "complete", "src/app.ts"),
      call("read-4", "read", "running", "src/other.ts"),
    ]),
  ).toBe("Read 1 file, 1 tool call failed, and 1 tool call still running");
});

it("names failed reads, edits and agents honestly", () => {
  expect(doneLabel(call("read", "read", "failed", "/tmp/diff"))).toBe(
    "Failed to read diff",
  );
  expect(doneLabel(call("edit", "file", "failed", "src/app.ts"))).toBe(
    "Failed to edit app.ts",
  );
  expect(doneLabel(call("agent", "agent", "failed", "Review security"))).toBe(
    "Agent failed: Review security",
  );
});
