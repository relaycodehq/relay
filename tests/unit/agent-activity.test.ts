import { it, expect } from "vitest";
import { claudeActivity, codexActivity } from "../../electron/rooms/activity";
import { publicMessage } from "../../electron/project-sharing";
it("caps retained output, represents failures, and excludes local execution traces when sharing", () => {
  const activity = codexActivity("item/completed", {
    id: "a",
    type: "commandExecution",
    command: "npm test",
    exitCode: 1,
    aggregatedOutput: "x".repeat(20000),
    arguments: { secret: "hidden" },
  })!;
  expect(activity.status).toBe("failed");
  expect(activity.detail).toHaveLength(8000);
  expect(JSON.stringify(activity)).not.toContain("hidden");
  expect(
    publicMessage({
      id: "message",
      role: "assistant",
      provider: "codex",
      status: "complete",
      body: "The check failed.",
      created: 1,
      version: 1,
      activity: [activity],
      trace: [{ kind: "commentary", id: "private", text: "private work" }],
    }),
  ).not.toHaveProperty("activity");
  expect(
    publicMessage({
      id: "m",
      role: "assistant",
      provider: "codex",
      status: "complete",
      body: "Public answer",
      created: 1,
      version: 1,
      trace: [{ kind: "commentary", id: "secret", text: "private work" }],
    }),
  ).not.toHaveProperty("trace");
  expect(
    codexActivity("item/started", {
      id: "b",
      type: "fileChange",
      changes: [{ path: "src/cache.ts", diff: "private patch" }],
    }),
  ).toEqual({
    id: "b",
    kind: "file",
    label: "src/cache.ts",
    status: "running",
    detail: "src/cache.ts",
  });
  expect(
    codexActivity("item/completed", {
      id: "c",
      type: "reasoning",
      summary: ["internal"],
    }),
  ).toBeUndefined();
  expect(
    claudeActivity("t", "Read", { file_path: "/repo/src/a.ts", limit: 4 }),
  ).toEqual({ id: "t", kind: "read", label: "/repo/src/a.ts", status: "running" });
  expect(
    claudeActivity("g", "Grep", { pattern: "useState", path: "src" }).label,
  ).toBe("useState in src");
  expect(claudeActivity("m", "mcp__linear__get_issue", { id: "x" }).label).toBe(
    "linear: get_issue",
  );
  expect(codexActivity("item/started", null)).toBeUndefined();
});
