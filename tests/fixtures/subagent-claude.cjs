// A Claude Code stand-in that sends three agents into the background and
// ends its turn, as Claude does by default. They keep working between turns:
// one reports back quickly, one later, one only stops when told to.
const session_id = "fixture-claude";
let count = 0;
const emit = (value) =>
  process.stdout.write(
    JSON.stringify({ uuid: `fixture-${++count}`, session_id, ...value }) + "\n",
  );
const root = process.cwd();
const agents = [
  {
    id: "toolu_render",
    task: "task-render",
    description: "Find where turns render",
    type: "Explore",
    model: "claude-haiku-4-5-20251001",
    prompt:
      "Find where Relay renders an agent turn and how a subagent's calls end up under its row. Report file paths; don't change anything.",
    calls: [
      ["Grep", { pattern: "AgentTurn", path: `${root}/src` }],
      ["Read", { file_path: `${root}/src/components/AgentTurn.tsx` }],
    ],
    said: "Turns render in AgentTurn; subagent calls nest by parentId.",
    report:
      "Turns render in `src/components/AgentTurn.tsx`, and `nestSubagents` folds a subagent's calls under its row.",
    ms: 2500,
  },
  {
    id: "toolu_sdk",
    task: "task-sdk",
    description: "Map the SDK's task events",
    type: "Explore",
    model: "claude-sonnet-5",
    prompt:
      "List every SDK message about subagents: what starts, updates and ends one.",
    calls: [
      ["Grep", { pattern: "task_started", path: `${root}/node_modules` }],
      ["Read", { file_path: `${root}/node_modules/sdk.d.ts` }],
    ],
    said: "task_started carries the brief and the agent type.",
    report: "`task_started`, `task_progress` and `task_notification` cover it.",
    // Long enough to still be going when the spec looks.
    ms: 20000,
  },
  {
    id: "toolu_phone",
    task: "task-phone",
    description: "Check the phone's turn view",
    type: "general-purpose",
    model: "claude-opus-5-5",
    prompt:
      "Check whether the phone app would show subagents the same way. It reads turns through shared/agent-trace.ts; confirm, and look at what shared/remote.ts sends for agent calls.",
    calls: [
      ["Read", { file_path: `${root}/shared/agent-trace.ts` }],
      [
        "Bash",
        { command: "npx vitest run tests/unit/phone-thread-state.test.ts" },
      ],
    ],
    said: "The phone nests subagent calls the same way, through readTurn.",
    // Works until it's stopped.
    ms: Infinity,
  },
];
const timers = new Map();
const running = new Set(agents.map((a) => a.task));
const live = () =>
  emit({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: agents
      .filter((a) => running.has(a.task))
      .map((a) => ({
        task_id: a.task,
        task_type: "local_agent",
        description: a.description,
      })),
  });
const said = (parent, id, content) =>
  emit({
    type: "assistant",
    parent_tool_use_id: parent,
    message: {
      id,
      role: "assistant",
      content,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });
const result = (parent, toolUseId, text, extra = {}) =>
  emit({
    type: "user",
    parent_tool_use_id: parent,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: text }],
    },
    ...extra,
  });
const later = (agent, ms, fn) => {
  if (!Number.isFinite(ms)) return;
  const timer = setTimeout(fn, ms);
  timers.set(agent.task, [...(timers.get(agent.task) ?? []), timer]);
};
function end(agent, status) {
  if (!running.delete(agent.task)) return;
  for (const timer of timers.get(agent.task) ?? []) clearTimeout(timer);
  live();
  emit({
    type: "system",
    subtype: "task_notification",
    task_id: agent.task,
    tool_use_id: agent.id,
    status,
    output_file: "",
    summary: `Agent "${agent.description}" ${status}`,
  });
}
function work(agent) {
  const [first, second] = agent.calls;
  later(agent, 200, () =>
    said(agent.id, `${agent.id}-a`, [
      {
        type: "tool_use",
        id: `${agent.id}-1`,
        name: first[0],
        input: first[1],
      },
    ]),
  );
  later(agent, 500, () => result(agent.id, `${agent.id}-1`, "matches found"));
  later(agent, 600, () => {
    said(agent.id, `${agent.id}-b`, [
      { type: "text", text: agent.said },
      {
        type: "tool_use",
        id: `${agent.id}-2`,
        name: second[0],
        input: second[1],
      },
    ]);
    emit({
      type: "system",
      subtype: "task_progress",
      task_id: agent.task,
      tool_use_id: agent.id,
      description: agent.description,
      usage: { total_tokens: 100, tool_uses: 2, duration_ms: 600 },
      last_tool_name: second[0],
      summary: `Working on ${agent.description.toLowerCase()}`,
    });
  });
  later(agent, agent.ms - 300, () =>
    result(agent.id, `${agent.id}-2`, "done reading"),
  );
  later(agent, agent.ms - 200, () =>
    said(agent.id, `${agent.id}-z`, [{ type: "text", text: agent.report }]),
  );
  later(agent, agent.ms, () => end(agent, "completed"));
}
function fanOut() {
  said(null, "fixture-plan", [
    { type: "text", text: "Three things to learn first. One agent each." },
    ...agents.map((a) => ({
      type: "tool_use",
      id: a.id,
      name: "Agent",
      input: {
        description: a.description,
        subagent_type: a.type,
        prompt: a.prompt,
      },
    })),
  ]);
  live();
  for (const a of agents) {
    emit({
      type: "system",
      subtype: "task_started",
      task_id: a.task,
      tool_use_id: a.id,
      description: a.description,
      subagent_type: a.type,
      task_type: "local_agent",
      is_backgrounded: true,
      prompt: a.prompt,
    });
    result(null, a.id, "Async agent launched successfully.", {
      tool_use_result: {
        status: "async_launched",
        agentId: a.task,
        description: a.description,
        prompt: a.prompt,
        resolvedModel: a.model,
      },
    });
  }
  said(null, "fixture-answer", [
    { type: "text", text: "Three agents are on it." },
  ]);
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Three agents are on it.",
    duration_ms: 1,
    duration_api_ms: 1,
    num_turns: 1,
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: {},
    permission_denials: [],
  });
  for (const a of agents) work(a);
}
require("node:readline")
  .createInterface({ input: process.stdin })
  .on("line", (line) => {
    const m = JSON.parse(line);
    if (m.type === "control_request") {
      emit({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: m.request_id,
          response: {
            commands: [],
            models: [],
            output_style: "default",
            available_output_styles: [],
          },
        },
      });
      if (m.request?.subtype === "stop_task") {
        const agent = agents.find((a) => a.task === m.request.task_id);
        if (agent) end(agent, "stopped");
      }
      return;
    }
    if (m.type === "user") fanOut();
  });
