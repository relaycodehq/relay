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

it("counts a call the user stopped as stopped, not failed", () => {
  expect(
    summarizeActivity([
      call("ls", "command", "complete"),
      call("rg", "command", "stopped", "rg cache src"),
    ]),
  ).toBe("Ran 1 command and 1 tool call stopped");
  expect(doneLabel(call("rg", "command", "stopped", "rg cache src"))).toBe(
    "Stopped rg",
  );
  expect(
    doneLabel(call("img", "tool", "stopped", "Generating an image")),
  ).toBe("Stopped: Generating an image");
});

it("counts every file a multi-file patch edited", () => {
  const patch: AgentActivity = {
    ...call("p", "file", "complete", "README.md +1 more"),
    detail: "README.md\nsrc/app.ts",
  };
  expect(
    summarizeActivity([patch, call("e", "file", "complete", "src/app.ts")]),
  ).toBe("Edited 2 files");
});

it("adds the calls a full trace let go of to the summary", () => {
  expect(
    summarizeActivity([call("build", "command", "complete")], {
      command: 140,
      read: 3,
      failed: 2,
    }),
  ).toBe("Ran 141 commands, read 3 files, and 2 tool calls failed");
});

it("counts the threads a start_threads call started, not the call", () => {
  const start = (id: string, ids: string[]): AgentActivity => ({
    ...call(id, "tool", "complete"),
    mcp: { server: "relay", tool: "start_threads" },
    detail: JSON.stringify(ids.map((t) => ({ id: t }))),
  });
  expect(
    summarizeActivity([
      call("stat", "command", "complete"),
      start("a", ["t1", "t2"]),
      start("b", ["t3"]),
    ]),
  ).toBe("Ran 1 command and started 3 threads");
});
