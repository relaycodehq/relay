import { expect, it } from "vitest";
import { readOnlyHook } from "./read-only-tools";

const call = (tool_name: string, tool_input: Record<string, unknown> = {}) =>
  readOnlyHook({ tool_name, tool_input });

const denied = { hookSpecificOutput: { permissionDecision: "deny" } };

it("turns down tools that write, act or move the session", async () => {
  for (const tool of ["Edit", "Write", "NotebookEdit", "EnterWorktree"])
    expect(await call(tool), tool).toMatchObject(denied);
  expect(await call("mcp__relay__move_to_worktree")).toMatchObject(denied);
  expect(await call("mcp__relay__send_to_thread")).toMatchObject(denied);
  expect(await call("mcp__computer-use__click")).toMatchObject(denied);
  expect(await call("Bash", { command: "rm -rf src" })).toMatchObject(denied);
});

it("lets reading through", async () => {
  expect(await call("Read", { file_path: "/project/a.ts" })).toEqual({});
  expect(await call("Grep")).toEqual({});
  expect(await call("mcp__relay__read_thread")).toEqual({});
  expect(await call("Bash", { command: "git log -5" })).toEqual({});
});
