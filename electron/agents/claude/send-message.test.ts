import { expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentActivity } from "../../../shared/projects";
import { claudeAgentRun, claudeAgents, runClaudeProject } from "./project";
import { deliveryOf } from "./send-message";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));

vi.mock("../../platform/executables", () => ({
  findExecutable: async (name: string) => `/usr/bin/${name}`,
}));

const session_id = "session";
const agentId = "a6d4a0faf46b6656c";
const task = "Render the full view";

// Frames as Claude Code 2.1.276 and 2.1.332 write them, read off their code
// rather than recorded, trimmed to the fields Relay reads; the receipts are theirs.
// Waking an agent starts its task again under the SendMessage call, while
// what the agent then does still names the Agent call that began it.
const assistant = (
  id: string,
  content: object[],
  parent: string | null = null,
) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  session_id,
  message: { id: `msg-${id}`, content, usage: {} },
});

const call = (
  id: string,
  name: string,
  input: object,
  parent: string | null = null,
) => assistant(id, [{ type: "tool_use", id, name, input }], parent);

const says = (id: string, text: string, parent: string | null = null) =>
  assistant(id, [{ type: "text", text }], parent);

const done = (
  id: string,
  text: string,
  parent: string | null = null,
  tool_use_result?: object,
) => ({
  type: "user",
  parent_tool_use_id: parent,
  session_id,
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content: text }],
  },
  ...(tool_use_result ? { tool_use_result } : {}),
});

const system = (subtype: string, fields: object) => ({
  type: "system",
  subtype,
  session_id,
  ...fields,
});

const started = (toolUseId: string, prompt: string) =>
  system("task_started", {
    task_id: agentId,
    tool_use_id: toolUseId,
    description: task,
    task_type: "local_agent",
    subagent_type: "general-purpose",
    is_backgrounded: true,
    prompt,
  });

const live = (...ids: string[]) =>
  system("background_tasks_changed", {
    tasks: ids.map((task_id) => ({
      task_id,
      task_type: "local_agent",
      description: task,
    })),
  });

const ended = (toolUseId: string) =>
  system("task_notification", {
    task_id: agentId,
    tool_use_id: toolUseId,
    status: "completed",
    summary: `Agent "${task}" completed`,
    output_file: "",
  });

const resumedReceipt = JSON.stringify({
  success: true,
  message: "Resuming agent a6d4a0f",
  resumedAgentId: agentId,
  pin: { id: "pin-1", name: "a6d4a0f", ref: "4f8039" },
});

const queuedReceipt = JSON.stringify({
  success: true,
  message: `Message queued for delivery to a6d4a0f at its next tool round.`,
});

/** Claude's agent, started in the background, with one call behind it. */
const agentAtWork = [
  call("agent", "Agent", { description: task, prompt: "Render it." }),
  live(agentId),
  started("agent", "Render it."),
  done("agent", "Async agent launched successfully.", null, {
    status: "async_launched",
    agentId,
  }),
  call("shot", "Bash", { command: "npm run shot" }, "agent"),
  done("shot", "saved full.png", "agent"),
];

/** A session that answers each prompt with the next turn's frames, then "Done.". */
function claudeSends(...turns: object[][]) {
  vi.mocked(query).mockImplementation((params) => {
    const input = (params.prompt as AsyncIterable<{ uuid: string }>)[
      Symbol.asyncIterator
    ]();
    return Object.assign(
      (async function* () {
        for (const [index, frames] of turns.entries()) {
          const sent = await input.next();
          yield {
            type: "command_lifecycle",
            command_uuid: sent.value.uuid,
            state: "started",
            session_id,
          };
          yield* frames;
          yield says(`answer-${index}`, "Done.");
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "Done.",
            session_id,
          };
        }
        await new Promise(() => {});
      })(),
      { close() {}, getContextUsage: async () => ({}) },
    ) as unknown as ReturnType<typeof query>;
  });
  const key = crypto.randomUUID();
  const onPeerSend = vi.fn();
  /** Runs the next turn; answers the rows it showed, by call. */
  const turn = async () => {
    const rows = new Map<string, AgentActivity>();
    await runClaudeProject({
      job: { kind: "prompt" },
      cwd: "/project",
      prompt: "Go on.",
      choice: {} as never,
      model: "",
      effort: "",
      signal: new AbortController().signal,
      onText() {},
      onActivity: (a) => rows.set(a.id, a),
      onPeerSend,
      session: { key, id: session_id, async onId() {} },
    });
    return rows;
  };
  return { key, turn, onPeerSend };
}

it("carries an agent a message woke on as the run it was", async () => {
  const message = "The header is clipped. Fix it and report back.";
  const { key, turn } = claudeSends(
    [
      ...agentAtWork,
      says("first", "The view renders.", "agent"),
      live(),
      ended("agent"),
    ],
    [
      call("send", "SendMessage", { to: agentId, message, summary: "fix" }),
      live(agentId),
      started("send", message),
      done("send", resumedReceipt),
      call("fix", "Bash", { command: "npm run fix" }, "agent"),
      system("task_progress", {
        task_id: agentId,
        tool_use_id: "send",
        description: task,
        usage: { total_tokens: 900, tool_uses: 1, duration_ms: 5 },
        last_tool_name: "Bash",
      }),
      done("fix", "header fits", "agent"),
    ],
    [says("second", "Header fixed.", "agent"), live(), ended("send")],
  );

  await turn();
  expect(claudeAgents(key)).toMatchObject([
    {
      id: "agent",
      status: "completed",
      calls: 1,
      outcome: "The view renders.",
    },
  ]);

  // The message is a row of its own, and what the woken agent does folds under it.
  const rows = await turn();
  expect(rows.get("send")).toEqual({
    id: "send",
    kind: "tool",
    label: `Message to agent: ${task}`,
    status: "complete",
    detail: `Resumed\n\n${message}`,
  });
  expect(rows.get("fix")).toMatchObject({
    parentId: "send",
    status: "complete",
  });
  // Still one agent, back at work: no second one that "reported" the receipt.
  expect(claudeAgents(key)).toMatchObject([
    { id: "agent", status: "running", calls: 2, brief: "Render it." },
  ]);
  expect(claudeAgents(key)[0]!.outcome).toBeUndefined();
  const working = claudeAgentRun(key, "agent")!;
  expect(working).not.toHaveProperty("report");
  expect(working.trace.map((e) => e.id)).toEqual([
    "shot",
    "text:msg-first",
    "heard:send",
    "fix",
  ]);
  // Quoted where it came in, so it doesn't read as the agent's words or a call.
  expect(working.trace[2]).toEqual({
    kind: "commentary",
    id: "heard:send",
    text: `**Message from Claude**\n\n> ${message}`,
  });

  await turn();
  expect(claudeAgentRun(key, "agent")).toMatchObject({
    status: "completed",
    calls: 2,
    report: "Header fixed.",
  });
  expect(claudeAgents(key)).toHaveLength(1);
});

it("leaves a message for an agent still at work with that agent", async () => {
  const message = "Also check the sidebar.";
  const { key, turn, onPeerSend } = claudeSends([
    ...agentAtWork,
    call("send", "SendMessage", { to: "a6d4a0f", message }),
    done("send", queuedReceipt),
    call("side", "Bash", { command: "npm run side" }, "agent"),
  ]);
  const rows = await turn();
  expect(rows.get("send")).toMatchObject({
    label: `Message to agent: ${task}`,
    status: "complete",
    detail: `Queued for its next step\n\n${message}`,
  });
  // It never stopped, so its calls stay under its own row.
  expect(rows.get("side")).toMatchObject({ parentId: "agent" });
  expect(claudeAgents(key)).toMatchObject([
    { id: "agent", status: "running", calls: 2 },
  ]);
  expect(claudeAgentRun(key, "agent")!.trace.map((e) => e.id)).toEqual([
    "shot",
    "heard:send",
    "side",
  ]);
  expect(onPeerSend).not.toHaveBeenCalled();
});

it("shows an agent it never saw start by the message that woke it", async () => {
  const message = "Pick the render up again.";
  const { key, turn } = claudeSends(
    [
      call("send", "SendMessage", { to: agentId, message }),
      started("send", message),
      done("send", resumedReceipt),
    ],
    [live(), ended("send")],
  );
  const rows = await turn();
  expect(rows.get("send")).toMatchObject({
    label: `Message to agent: ${task}`,
    detail: `Resumed\n\n${message}`,
  });
  // The receipt doesn't end it; the task's own word does.
  expect(claudeAgentRun(key, "send")).toMatchObject({
    description: task,
    brief: message,
    status: "running",
    trace: [],
  });
  await turn();
  expect(claudeAgentRun(key, "send")).toMatchObject({
    status: "completed",
    report: `Agent "${task}" completed`,
  });
});

it("keeps a message to another session as the call it was", async () => {
  const receipt = '{"success":true,"msg_id":"x"}';
  const toMain =
    '{"success":true,"message":"Message queued for the main conversation\'s next turn."}';
  const { key, turn, onPeerSend } = claudeSends([
    ...agentAtWork,
    call("peer", "SendMessage", {
      to: "mudtoy-d4",
      message: "Can I have Play?",
    }),
    done("peer", receipt),
    call("main", "SendMessage", { to: "main", message: "Done here." }, "agent"),
    done("main", toMain, "agent"),
  ]);
  const rows = await turn();
  expect(rows.get("peer")).toEqual({
    id: "peer",
    kind: "tool",
    label: "SendMessage",
    status: "complete",
    detail: receipt,
  });
  expect(rows.get("main")).toMatchObject({
    label: "SendMessage",
    parentId: "agent",
    detail: toMain,
  });
  expect(onPeerSend).toHaveBeenCalledWith({
    to: "mudtoy-d4",
    message: "Can I have Play?",
  });
  // Neither message is in the agent's trace as one it heard from Claude.
  expect(claudeAgentRun(key, "agent")!.trace.map((e) => e.id)).toEqual([
    "shot",
    "main",
  ]);
});

it("reads how a message reached an agent from its receipt", () => {
  expect(deliveryOf(resumedReceipt)).toEqual({
    how: "resumed",
    agentId,
  });
  expect(deliveryOf(queuedReceipt)).toEqual({ how: "queued" });
  // 2.1.332 names an agent it woke for another agent, and says more after.
  expect(
    deliveryOf(
      `{"success":true,"message":"Resuming agent a6d4a0f. The agent is working in the background. You will be notified automatically when it completes.","revivedAgentId":"${agentId}"}`,
    ),
  ).toEqual({ how: "resumed", agentId });
  expect(
    deliveryOf(
      '{"success":true,"message":"Message queued for delivery to a6d4a0f at its next tool round. If it finishes first, it is resumed with the message and notifies again, so wait for that notification before resending."}',
    ),
  ).toEqual({ how: "queued" });
  expect(
    deliveryOf(
      '{"success":true,"message":"a6d4a0f is already waking; message queued for its next tool round (not delivered if the agent turns out to have been stopped)."}',
    ),
  ).toEqual({ how: "queued" });
  expect(
    deliveryOf(
      '{"success":false,"message":"Agent \\"a6d4a0f\\" was stopped by the user and was not resumed."}',
    ),
  ).toBeUndefined();
  expect(deliveryOf("Error: unknown recipient")).toBeUndefined();
});
