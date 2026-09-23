import { expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runClaudeProject } from "../../electron/rooms/claude-project";
import type { AgentActivity } from "../../shared/projects";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("../../electron/executables", () => ({
  findExecutable: async (name: string) => `/usr/bin/${name}`,
}));

const session_id = "session";
const answer = (text: string) => ({
  type: "assistant",
  parent_tool_use_id: null,
  session_id,
  message: { id: "msg", content: [{ type: "text", text }], usage: {} },
});
const result = (text: string, origin?: { kind: string }) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: text,
  session_id,
  ...(origin ? { origin } : {}),
});
const lifecycle = (command_uuid: string, state: string) => ({
  type: "command_lifecycle",
  command_uuid,
  state,
  session_id,
});

/** Claude as the CLI answers one prompt, given the frames it writes for it. */
function claude(frames: (prompt: string) => object[]) {
  vi.mocked(query).mockImplementation(({ prompt }) => {
    const input = (prompt as AsyncIterable<{ uuid: string }>)[
      Symbol.asyncIterator
    ]();
    return Object.assign(
      (async function* () {
        const sent = await input.next();
        yield* frames(sent.value.uuid);
        await new Promise(() => {});
      })(),
      { close() {} },
    ) as unknown as ReturnType<typeof query>;
  });
}

const run = () =>
  runClaudeProject({
    cwd: "/project",
    prompt: "Reply with just the word banana.",
    choice: {} as never,
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    session: { key: crypto.randomUUID(), id: session_id, async onId() {} },
  });

it("skips the result a resumed session reports for a leftover background command", async () => {
  // Frame order the CLI wrote when resumed with a stopped `sleep` still on record.
  claude((uuid) => [
    { type: "system", subtype: "task_notification", status: "stopped" },
    { type: "system", subtype: "init", session_id },
    result("", { kind: "task-notification" }),
    lifecycle(uuid, "queued"),
    lifecycle(uuid, "started"),
    answer("banana"),
    result("banana"),
  ]);
  await expect(run()).resolves.toBe("banana");
});

it("skips any result that lands while the prompt is still queued", async () => {
  claude((uuid) => [
    lifecycle(uuid, "queued"),
    answer("A background task finished."),
    result("A background task finished."),
    lifecycle(uuid, "started"),
    answer("banana"),
    result("banana"),
  ]);
  await expect(run()).resolves.toBe("banana");
});

it("still reports an empty answer to the prompt itself", async () => {
  claude((uuid) => [
    lifecycle(uuid, "queued"),
    lifecycle(uuid, "started"),
    result(""),
  ]);
  await expect(run()).rejects.toThrow("Claude returned an empty answer.");
});

it("nests a subagent's calls under its agent call and reports its progress", async () => {
  const call = (
    id: string,
    name: string,
    input: object,
    parent: string | null,
  ) => ({
    type: "assistant",
    parent_tool_use_id: parent,
    session_id,
    message: {
      id: `msg-${id}`,
      content: [{ type: "tool_use", id, name, input }],
      usage: {},
    },
  });
  const done = (id: string, text: string, parent: string | null) => ({
    type: "user",
    parent_tool_use_id: parent,
    session_id,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: text }],
    },
  });
  const progress = (summary?: string) => ({
    type: "system",
    subtype: "task_progress",
    task_id: "task",
    tool_use_id: "agent",
    description: "Explore auth",
    usage: { total_tokens: 10, tool_uses: 1, duration_ms: 5 },
    last_tool_name: "Read",
    ...(summary ? { summary } : {}),
    session_id,
  });
  claude((uuid) => [
    lifecycle(uuid, "started"),
    call("agent", "Agent", { description: "Explore auth" }, null),
    call("read", "Read", { file_path: "/project/auth.ts" }, "agent"),
    progress(),
    progress("Reading the auth module"),
    done("read", "export {}", "agent"),
    done("agent", "Auth lives in auth.ts.", null),
    progress("Too late"),
    answer("banana"),
    result("banana"),
  ]);
  const seen: AgentActivity[] = [];
  await runClaudeProject({
    cwd: "/project",
    prompt: "Where is auth?",
    choice: {} as never,
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    onActivity: (a) => seen.push({ ...a }),
    session: { key: crypto.randomUUID(), id: session_id, async onId() {} },
  });
  expect(seen.filter((a) => a.id === "read").map((a) => a.parentId)).toEqual([
    "agent",
    "agent",
  ]);
  const agent = seen.filter((a) => a.id === "agent");
  expect(agent.map((a) => [a.status, a.progress])).toEqual([
    ["running", undefined],
    ["running", "Using Read · 1 tool"],
    ["running", "Reading the auth module · 1 tool"],
    ["complete", undefined],
  ]);
  expect(agent.at(-1)).toMatchObject({ detail: "Auth lives in auth.ts." });
  expect(agent.every((a) => !a.parentId)).toBe(true);
});
