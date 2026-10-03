import { expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  closeClaudeSession,
  reloadClaudeSession,
  runClaudeProject,
} from "./index";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("../../../platform/executables", () => ({
  findExecutable: async (name: string) => `/usr/bin/${name}`,
}));

type Options = NonNullable<Parameters<typeof query>[0]["options"]>;
type Sent = { message: { content: { text?: string }[] | string } };
const session_id = "session";

/**
 * Claude Code processes as `query` starts them: each answers every prompt
 * with "ok" and lists the skills and agents of its launch, `loads[n]`.
 */
function claudes(loads: { skills: string[]; agents: string[] }[]) {
  const started: { options: Options; prompts: Sent[]; close: () => void }[] =
    [];
  vi.mocked(query).mockReset();
  vi.mocked(query).mockImplementation((params) => {
    const load = loads[started.length]!;
    const process = {
      options: params.options!,
      prompts: [] as Sent[],
      close: vi.fn(),
    };
    started.push(process);
    const input = params.prompt as AsyncIterable<Sent>;
    return Object.assign(
      (async function* () {
        for await (const sent of input) {
          process.prompts.push(sent);
          if (JSON.stringify(sent).includes("Hold on")) {
            const signal = params.options!.abortController!.signal;
            await new Promise((r) => signal.addEventListener("abort", r));
            throw new Error("Aborted.");
          }
          yield {
            type: "assistant",
            parent_tool_use_id: null,
            session_id,
            message: { id: "m", content: [{ type: "text", text: "ok" }] },
          };
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "ok",
            session_id,
          };
        }
      })(),
      {
        close: process.close,
        getContextUsage: async () => ({}),
        supportedCommands: async () =>
          load.skills.map((name) => ({ name, description: "" })),
        supportedAgents: async () =>
          load.agents.map((name) => ({ name, description: "" })),
      },
    ) as unknown as ReturnType<typeof query>;
  });
  return started;
}

const turn = (key: string, prompt = "Go.", signal?: AbortSignal) =>
  runClaudeProject({
    job: { kind: "prompt" },
    cwd: "/project",
    prompt,
    choice: {} as never,
    model: "opus",
    effort: "high",
    runtimeMode: "full-access",
    signal: signal ?? new AbortController().signal,
    onText() {},
    session: { key, async onId() {} },
  });

it("restarts an idle session on its conversation, and the next turn runs in the fresh one", async () => {
  const started = claudes([
    { skills: ["compact", "old"], agents: ["reviewer"] },
    { skills: ["compact", "release"], agents: ["reviewer", "planner"] },
  ]);
  const key = crypto.randomUUID();
  await turn(key);
  expect(started).toHaveLength(1);
  expect(started[0].options.resume).toBeUndefined();

  await expect(reloadClaudeSession(key)).resolves.toEqual({
    skills: { added: ["release"], removed: ["old"] },
    agents: { added: ["planner"], removed: [] },
  });
  expect(started[0].close).toHaveBeenCalled();
  expect(started).toHaveLength(2);
  // Same conversation, same settings: only the process is new.
  expect(started[1].options).toMatchObject({
    resume: session_id,
    model: "opus",
    effort: "high",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
  });

  await expect(turn(key, "Again.")).resolves.toBe("ok");
  expect(started).toHaveLength(2);
  expect(JSON.stringify(started[1].prompts)).toContain("Again.");
  closeClaudeSession(key);
});

it("won't restart a session in the middle of a turn", async () => {
  const started = claudes([{ skills: [], agents: [] }]);
  const key = crypto.randomUUID();
  await turn(key);
  const stop = new AbortController();
  const running = turn(key, "Hold on.", stop.signal).catch(() => {});
  await vi.waitFor(() => expect(started[0].prompts).toHaveLength(2));
  await expect(reloadClaudeSession(key)).rejects.toThrow("still working");
  expect(started[0].close).not.toHaveBeenCalled();
  stop.abort();
  await running;
});

it("starts nothing when no session is live", async () => {
  const started = claudes([]);
  await expect(reloadClaudeSession(crypto.randomUUID())).resolves.toBe(
    undefined,
  );
  expect(started).toHaveLength(0);
});
