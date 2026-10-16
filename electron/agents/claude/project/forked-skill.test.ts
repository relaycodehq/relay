import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentActivity } from "../../../../shared/projects";
import { claudeAgentRun, runClaudeProject } from ".";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("../../../platform/executables", () => ({
  findExecutable: async (name: string) => `/usr/bin/${name}`,
}));

const session_id = "session";
let home: string;
let transcript: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "relay-fork-"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", home);
  const folder = join(home, "projects", "-some-project");
  await mkdir(join(folder, session_id, "subagents"), { recursive: true });
  await writeFile(join(folder, `${session_id}.jsonl`), "");
  transcript = join(folder, session_id, "subagents", "agent-t1.jsonl");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const bash = {
  id: "msg-1",
  content: [
    {
      type: "tool_use",
      id: "bash",
      name: "Bash",
      input: { command: "sleep 6" },
    },
  ],
};
const bashDone = {
  role: "user",
  content: [{ type: "tool_result", tool_use_id: "bash", content: "" }],
};
const answer = { id: "msg-2", content: [{ type: "text", text: "probe done" }] };

// The frames Claude Code 2.1.301 sent for `/probe`, a `context: fork` skill:
// nothing of its work streams until it ends, then it replays under a made-up parent.
it("shows a forked skill as a subagent, live from its transcript, then from its replay", async () => {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  vi.mocked(query).mockImplementation((params) => {
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
          type: "system",
          subtype: "task_started",
          task_id: "t1",
          description: "/probe",
          subagent_type: "general-purpose",
          is_backgrounded: false,
          task_type: "local_agent",
          prompt: "Run `sleep 6`, then answer.",
          session_id,
        };
        await finished;
        yield {
          type: "system",
          subtype: "task_notification",
          task_id: "t1",
          status: "completed",
          summary: "/probe",
          output_file: transcript,
          skip_transcript: true,
          ambient: true,
          session_id,
        };
        const replay = {
          parent_tool_use_id: "forked-command-probe",
          session_id,
        };
        yield { type: "assistant", message: bash, ...replay };
        yield { type: "user", message: bashDone, ...replay };
        yield { type: "assistant", message: answer, ...replay };
        yield {
          type: "assistant",
          message: answer,
          parent_tool_use_id: null,
          session_id,
        };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "probe done",
          session_id,
        };
      })(),
      { close() {}, getContextUsage: async () => ({}) },
    ) as unknown as ReturnType<typeof query>;
  });
  const rows = new Map<string, AgentActivity>();
  const key = crypto.randomUUID();
  const turn = runClaudeProject({
    job: { kind: "prompt" },
    cwd: "/project",
    prompt: "/probe",
    choice: {} as never,
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    onActivity: (a) => rows.set(a.id, a),
    session: { key, id: session_id, async onId() {} },
  });

  // Started: a row in the turn and a run in the composer's card, though no Agent call made them.
  await vi.waitFor(() =>
    expect(rows.get("fork:t1")).toMatchObject({
      kind: "agent",
      label: "/probe",
      status: "running",
    }),
  );
  expect(claudeAgentRun(key, "fork:t1")).toMatchObject({
    description: "/probe",
    status: "running",
  });

  // While it works, what it writes to its transcript shows under it.
  await appendFile(
    transcript,
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "Run `sleep 6`" },
    }) +
      "\n" +
      JSON.stringify({ type: "assistant", uuid: "u1", message: bash }) +
      "\n",
  );
  await vi.waitFor(() =>
    expect(rows.get("bash")).toMatchObject({
      parentId: "fork:t1",
      status: "running",
      label: "sleep 6",
    }),
  );
  expect(claudeAgentRun(key, "fork:t1")).toMatchObject({ calls: 1 });

  finish();
  await turn;
  expect(rows.get("fork:t1")).toMatchObject({ status: "complete" });
  expect(rows.get("bash")).toMatchObject({
    parentId: "fork:t1",
    status: "complete",
  });
  expect(claudeAgentRun(key, "fork:t1")).toMatchObject({
    status: "completed",
    calls: 1,
    report: "probe done",
  });
});
