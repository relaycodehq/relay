import { expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runClaudeProject } from "../../electron/rooms/claude-project";

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
