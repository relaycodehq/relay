import { expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runClaudeProject } from "./claude-project";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("../platform/executables", () => ({
  findExecutable: async (name: string) => `/usr/bin/${name}`,
}));

const session_id = "session";

it("keeps a deep review's Claude reviewer from changing the checkout", async () => {
  let options!: NonNullable<Parameters<typeof query>[0]["options"]>;
  vi.mocked(query).mockImplementation((params) => {
    options = params.options!;
    const input = (params.prompt as AsyncIterable<{ uuid: string }>)[
      Symbol.asyncIterator
    ]();
    return Object.assign(
      (async function* () {
        const sent = await input.next();
        yield {
          type: "command_lifecycle",
          command_uuid: sent.value.uuid,
          state: "started",
          session_id,
        };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "No findings.",
          session_id,
        };
        await new Promise(() => {});
      })(),
      { close() {}, getContextUsage: async () => ({}) },
    ) as unknown as ReturnType<typeof query>;
  });
  await runClaudeProject({
    cwd: "/project",
    prompt: "/code-review high",
    choice: {} as never,
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    runtimeMode: "approval-required",
    interactionMode: "default",
    readOnly: true,
    session: { key: crypto.randomUUID(), async onId() {} },
  });
  const ask = (tool: string, input: Record<string, unknown>) =>
    options.canUseTool!(tool, input, {
      signal: new AbortController().signal,
      toolUseID: "tool",
      requestId: "request",
    });
  // Claude Code runs the commands it knows only read without asking; any
  // command that asks might change files.
  expect(
    (await ask("Bash", { command: "git checkout -- src" }))?.behavior,
  ).toBe("deny");
  expect((await ask("AskUserQuestion", { questions: [] }))?.behavior).toBe(
    "deny",
  );
  // Allow rules in the user's settings skip canUseTool, but not these.
  expect(options.disallowedTools).toEqual(
    expect.arrayContaining(["Edit", "MultiEdit", "Write", "NotebookEdit"]),
  );
});
