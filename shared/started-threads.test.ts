import { describe, expect, it } from "vitest";
import type { AgentActivity } from "./projects";
import { isStartThreads, startedIds } from "./started-threads";

it("recognizes only Relay's start_threads tool", () => {
  const call: AgentActivity = {
    id: "call",
    kind: "tool",
    status: "complete",
    label: "Started threads",
    mcp: { server: "relay", tool: "start_threads" },
  };
  expect(isStartThreads(call)).toBe(true);
  expect(isStartThreads({ ...call, mcp: undefined })).toBe(false);
  expect(
    isStartThreads({
      ...call,
      mcp: { server: "other", tool: "start_threads" },
    }),
  ).toBe(false);
  expect(
    isStartThreads({ ...call, mcp: { server: "relay", tool: "other" } }),
  ).toBe(false);
});

describe("startedIds", () => {
  it("reads the ids, skipping the threads that failed to start", () => {
    expect(
      startedIds(
        JSON.stringify([{ id: "a" }, { error: "bad model" }, { id: "b" }]),
      ),
    ).toEqual(["a", "b"]);
  });

  it("gives up on an error message or a result cut short", () => {
    expect(startedIds("The user didn't start these threads.")).toBeUndefined();
    expect(startedIds('[{"id":"a"},{"id":')).toBeUndefined();
    expect(
      startedIds(JSON.stringify([{ error: "bad model" }])),
    ).toBeUndefined();
    expect(startedIds(undefined)).toBeUndefined();
    expect(startedIds('{"id":"a"}')).toBeUndefined();
  });
});
