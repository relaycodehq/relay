import { expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { SubagentTracker } from "./claude-agents";
import {
  claudeAgentRun,
  claudeAgents,
  runClaudeProject,
  stopClaudeAgent,
} from "./claude-project";
import {
  modelName,
  runningBatch,
  type SubagentRun,
} from "../../shared/subagents";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("../platform/executables", () => ({
  findExecutable: async (name: string) => `/usr/bin/${name}`,
}));

const session_id = "session";
// Frames as the CLI writes them, trimmed to the fields the tracker reads.
const call = (
  id: string,
  name: string,
  input: object,
  parent: string | null = null,
  text?: string,
) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  session_id,
  message: {
    id: `msg-${id}`,
    content: [
      ...(text ? [{ type: "text", text }] : []),
      { type: "tool_use", id, name, input },
    ],
    usage: {},
  },
});
const says = (id: string, text: string, parent: string) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  session_id,
  message: { id, content: [{ type: "text", text }], usage: {} },
});
const done = (
  id: string,
  text: string,
  parent: string | null = null,
  extra: object = {},
) => ({
  type: "user",
  parent_tool_use_id: parent,
  session_id,
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content: text }],
  },
  ...extra,
});
const system = (subtype: string, fields: object) => ({
  type: "system",
  subtype,
  session_id,
  ...fields,
});
const started = (id: string, task: string, background: boolean) =>
  system("task_started", {
    task_id: task,
    tool_use_id: id,
    description: "Map the SDK",
    task_type: "local_agent",
    subagent_type: "Explore",
    is_backgrounded: background,
    prompt: "List every task message.",
  });
const live = (...ids: string[]) =>
  system("background_tasks_changed", {
    tasks: ids.map((task_id) => ({
      task_id,
      task_type: "local_agent",
      description: "Map the SDK",
    })),
  });

function tracker() {
  let now = 1000;
  const agents = new SubagentTracker(() => now);
  return {
    agents,
    feed: (...frames: object[]) =>
      frames.forEach((f) => agents.observe(f as never)),
    tick: (ms: number) => (now += ms),
  };
}

it("follows a foreground agent to its answer", () => {
  const { agents, feed, tick } = tracker();
  feed(
    call("agent", "Agent", {
      description: "Map the SDK",
      subagent_type: "Explore",
      model: "sonnet",
      prompt: "List every task message.",
    }),
    started("agent", "t1", false),
    call(
      "read",
      "Read",
      { file_path: "/p/sdk.d.ts" },
      "agent",
      "Reading the types.",
    ),
    system("task_progress", {
      task_id: "t1",
      tool_use_id: "agent",
      description: "Map the SDK",
      usage: { total_tokens: 10, tool_uses: 1, duration_ms: 5 },
      summary: "Reading the SDK types",
    }),
  );
  expect(agents.list()).toMatchObject([
    {
      id: "agent",
      description: "Map the SDK",
      type: "Explore",
      model: "sonnet",
      brief: "List every task message.",
      status: "running",
      summary: "Reading the SDK types",
      calls: 1,
      recent: [{ kind: "read", label: "/p/sdk.d.ts", status: "running" }],
    },
  ]);
  tick(5000);
  feed(
    done("read", "export type SDKTaskStartedMessage…", "agent"),
    says(
      "final",
      "Three task messages start, update and end an agent.",
      "agent",
    ),
    done("agent", "Three task messages…\nagentId: abc", null, {
      tool_use_result: {
        status: "completed",
        resolvedModel: "claude-sonnet-5",
        content: [{ type: "text", text: "Three task messages…" }],
      },
    }),
  );
  const run = agents.detail("agent")!;
  expect(run).toMatchObject({
    status: "completed",
    ended: 6000,
    model: "claude-sonnet-5",
    summary: undefined,
    // Its own last word, not the copy that carries ids for the model.
    report: "Three task messages start, update and end an agent.",
    outcome: "Three task messages start, update and end an agent.",
  });
  // What it said before its call reads first; the report isn't repeated;
  // finished calls keep their output.
  expect(run.trace.map((e) => e.id)).toEqual(["text:msg-read", "read"]);
  expect(run.trace[1]).toMatchObject({
    activity: {
      status: "complete",
      detail: "export type SDKTaskStartedMessage…",
    },
  });
  // The card never carries call output.
  expect(agents.list()[0]!.recent[0]).not.toHaveProperty("detail");
});

it("keeps a background agent running past its launch until the task ends", () => {
  const { agents, feed } = tracker();
  feed(
    call("agent", "Agent", {
      description: "Map the SDK",
      prompt: "List them.",
    }),
    live("t1"),
    started("agent", "t1", true),
    done("agent", "Async agent launched successfully.", null, {
      tool_use_result: {
        status: "async_launched",
        agentId: "t1",
        resolvedModel: "claude-opus-5-5",
      },
    }),
    call("grep", "Grep", { pattern: "task_" }, "agent"),
  );
  expect(agents.list()[0]).toMatchObject({
    status: "running",
    model: "claude-opus-5-5",
    calls: 1,
  });
  expect(agents.taskId("agent")).toBe("t1");
  // The live set drops it before the task says how it went; the task's word wins.
  feed(live());
  expect(agents.list()[0]!.status).toBe("completed");
  feed(
    system("task_notification", {
      task_id: "t1",
      tool_use_id: "agent",
      status: "failed",
      summary: "Agent failed",
      output_file: "",
    }),
  );
  expect(agents.detail("agent")).toMatchObject({
    status: "failed",
    report: "Agent failed",
    trace: [{ activity: { status: "failed" } }],
  });
  expect(agents.taskId("agent")).toBeUndefined();
});

it("ignores background commands and ends what's left when the session does", () => {
  const { agents, feed } = tracker();
  feed(
    system("task_started", {
      task_id: "bash",
      tool_use_id: "cmd",
      description: "npm test",
      task_type: "local_bash",
    }),
    call("agent", "Agent", { description: "Check the phone" }),
  );
  expect(agents.list().map((r) => r.id)).toEqual(["agent"]);
  agents.close();
  expect(agents.list()[0]!.status).toBe("stopped");
});

it("counts every agent since the first of a fan-out, and resets after it", () => {
  const run = (id: string, started: number, ended?: number): SubagentRun => ({
    id,
    description: id,
    status: ended ? "completed" : "running",
    started,
    ended,
    calls: 0,
    recent: [],
  });
  // One back, one still going, one started while it went: all one fan-out.
  const runs = [run("a", 0, 50), run("b", 10), run("c", 60)];
  expect(runningBatch(runs, 100).map((r) => r.id)).toEqual(["a", "b", "c"]);
  // All back: nothing to show.
  expect(runningBatch([run("a", 0, 50), run("b", 10, 90)], 100)).toEqual([]);
  // A later fan-out starts from nothing.
  expect(
    runningBatch([run("a", 0, 50), run("b", 70)], 100).map((r) => r.id),
  ).toEqual(["b"]);
});

it("names models the way the picker does", () => {
  expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
  expect(modelName("claude-sonnet-5")).toBe("Sonnet 5");
  expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  expect(modelName("claude-sonnet-4-20250514")).toBe("Sonnet 4");
  expect(modelName("haiku")).toBe("Haiku");
});

it("keeps following agents after the turn that started them ends", async () => {
  const stopTask = vi.fn(async () => {});
  let later!: () => void;
  const after = new Promise<void>((resolve) => (later = resolve));
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
        yield call("agent", "Agent", { description: "Map the SDK" });
        yield live("t1");
        yield started("agent", "t1", true);
        yield done("agent", "Async agent launched successfully.");
        yield {
          type: "assistant",
          parent_tool_use_id: null,
          session_id,
          message: {
            id: "msg",
            content: [{ type: "text", text: "Sent an agent." }],
            usage: {},
          },
        };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Sent an agent.",
          session_id,
        };
        await after;
        // Between turns: the agent keeps working, then reports back.
        yield call("read", "Read", { file_path: "/p/sdk.d.ts" }, "agent");
        yield says("final", "Found three task messages.", "agent");
        yield live();
        await new Promise(() => {});
      })(),
      { close() {}, stopTask, getContextUsage: async () => ({}) },
    ) as unknown as ReturnType<typeof query>;
  });
  const key = crypto.randomUUID();
  await runClaudeProject({
    cwd: "/project",
    prompt: "Map the SDK with an agent.",
    choice: {} as never,
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    session: { key, id: session_id, async onId() {} },
  });
  // Without it the SDK sends a subagent's calls but none of its text.
  expect(options.forwardSubagentText).toBe(true);
  expect(claudeAgents(key)).toMatchObject([{ id: "agent", status: "running" }]);
  await stopClaudeAgent(key, "agent");
  expect(stopTask).toHaveBeenCalledWith("t1");
  later();
  await vi.waitFor(() =>
    expect(claudeAgentRun(key, "agent")).toMatchObject({
      status: "completed",
      calls: 1,
      report: "Found three task messages.",
    }),
  );
  await expect(stopClaudeAgent(key, "agent")).rejects.toThrow(
    "That agent has already finished.",
  );
});
