import { it, expect } from "vitest";
import { codexActivity } from "../../electron/rooms/activity";
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
    label: "Changed 1 file",
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
  expect(codexActivity("item/started", null)).toBeUndefined();
});
