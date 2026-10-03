// Sample run for the subagents preview: Claude sends three agents out, starts
// a fourth once the first reports back, and answers when they're all done.
// Everything is a function of the preview clock, in seconds.
import type {
  AgentActivity,
  AgentTrace,
  ChatMessage,
} from "../../shared/projects";

export const projectRoot = "/Users/sample/relay";
export const clockEnd = 200;

const p = (path: string) => `${projectRoot}/${path}`;

type CallKind = Exclude<AgentActivity["kind"], "agent">;
type Step =
  { at: number; text: string } | { at: number; kind: CallKind; label: string };

export interface AgentScript {
  id: string;
  description: string;
  type: string;
  model: string;
  /** The prompt Claude wrote for it. */
  brief: string;
  start: number;
  end: number;
  /** Seconds after the agent starts. */
  steps: Step[];
  /** The SDK's one-line progress summaries, seconds after the start. */
  summaries: { at: number; text: string }[];
  /** What it hands back to Claude. */
  report: string;
}

export const scripts: AgentScript[] = [
  {
    id: "agent-render",
    description: "Find where turns render",
    type: "Explore",
    model: "Haiku 4.5",
    brief:
      "Find where Relay renders an agent turn and how a subagent's tool calls end up under its agent row. Also find the row above the composer that holds the Project folder and branch controls. Report file paths and the functions involved; don't change anything.",
    start: 6,
    end: 58,
    steps: [
      { at: 1, kind: "search", label: `AgentTurn in ${p("src")}` },
      { at: 5, kind: "read", label: p("src/components/AgentTurn.tsx") },
      {
        at: 13,
        text: "Subagent calls fold under their agent row through `nestSubagents`, keyed by `parentId`.",
      },
      { at: 15, kind: "read", label: p("shared/agent-trace.ts") },
      { at: 23, kind: "search", label: `parentId in ${p("shared")}` },
      { at: 29, kind: "read", label: p("src/components/ProjectChat.tsx") },
      {
        at: 38,
        kind: "search",
        label: `thread-context-controls in ${p("src")}`,
      },
      { at: 44, kind: "read", label: p("src/components/ProjectComposer.tsx") },
    ],
    summaries: [
      { at: 8, text: "Reading AgentTurn.tsx" },
      { at: 26, text: "Tracing parentId through agent-trace.ts" },
      { at: 40, text: "Finding the composer's context row" },
    ],
    report:
      "Turns render in `src/components/AgentTurn.tsx`. `nestSubagents` in `shared/agent-trace.ts` moves a subagent's calls under its agent row by `parentId`.\n\nThe row above the composer is `.thread-context-controls` in `ProjectComposer.tsx`; `ProjectChat.tsx` passes the Project folder control in as `workspace`. Nothing tracks subagents outside the turn's trace.",
  },
  {
    id: "agent-sdk",
    description: "Map the SDK's task events",
    type: "Explore",
    model: "Sonnet 5",
    brief:
      "Read the Claude Agent SDK types in node_modules and list every message and control call about subagents: what starts, updates and ends one, whether a host can stop one or send it a message, and what Relay already reads in electron/rooms/claude-project.ts.",
    start: 7,
    end: 128,
    steps: [
      { at: 2, kind: "search", label: `task_progress in ${p("electron")}` },
      { at: 7, kind: "read", label: p("electron/rooms/claude-project.ts") },
      {
        at: 19,
        text: "Relay turns on `agentProgressSummaries` and reads `task_progress`, but skips `task_started` and `task_notification`.",
      },
      {
        at: 23,
        kind: "search",
        label: `SDKTaskStartedMessage in ${p("node_modules/@anthropic-ai/claude-agent-sdk")}`,
      },
      {
        at: 31,
        kind: "read",
        label: p("node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts"),
      },
      { at: 49, kind: "search", label: "stopTask|backgroundTasks" },
      {
        at: 58,
        kind: "read",
        label: p("node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts"),
      },
      {
        at: 76,
        text: "`AgentInput.name` lets Claude `SendMessage` a running agent. There's no host call that does it.",
      },
      { at: 82, kind: "search", label: "getSubagentMessages" },
      { at: 95, kind: "read", label: p("electron/rooms/activity.ts") },
      {
        at: 108,
        kind: "command",
        label: "grep -c parent_tool_use_id electron/rooms/claude-project.ts",
      },
    ],
    summaries: [
      { at: 10, text: "Reading claude-project.ts" },
      { at: 38, text: "Reading the SDK's task message types" },
      { at: 66, text: "Checking the Agent tool's input" },
      { at: 98, text: "Checking how activity labels agents" },
    ],
    report:
      "`task_started` carries `description`, `subagent_type`, `prompt`, `is_backgrounded` and `spawn_depth`; `task_progress` the ~30s `summary` and usage; `task_notification` how it ended.\n\n`stopTask(taskId)` stops one agent. No host call sends a subagent a message: `SendMessage` is a tool Claude itself calls, and only for agents it gave a `name`. `getSubagentMessages` reads an agent's transcript afterwards.",
  },
  {
    id: "agent-phone",
    description: "Check the phone's turn view",
    type: "general-purpose",
    model: "Opus 5.5",
    brief:
      "Check whether the phone app would show subagents the same way. It reads turns through shared/agent-trace.ts; confirm, look at what shared/remote.ts sends for agent calls, and run the phone thread tests.",
    start: 8,
    end: 170,
    steps: [
      { at: 3, kind: "read", label: p("shared/agent-trace.ts") },
      { at: 9, kind: "search", label: `readTurn in ${p("mobile/src")}` },
      { at: 17, kind: "read", label: p("mobile/src/ui/MessageView.tsx") },
      {
        at: 33,
        text: "The phone nests subagent calls the same way, through `readTurn`.",
      },
      { at: 39, kind: "read", label: p("shared/remote.ts") },
      {
        at: 57,
        kind: "search",
        label: `AgentActivity in ${p("shared/remote.ts")}`,
      },
      { at: 71, kind: "read", label: p("mobile/src/app/turn.tsx") },
      {
        at: 95,
        kind: "command",
        label: "npx vitest run tests/unit/phone-thread-state.test.ts",
      },
      {
        at: 127,
        kind: "read",
        label: p("tests/unit/phone-thread-state.test.ts"),
      },
      { at: 143, kind: "command", label: "npx tsc --noEmit -p mobile" },
    ],
    summaries: [
      { at: 12, text: "Reading the phone's MessageView" },
      { at: 48, text: "Checking the remote protocol" },
      { at: 99, text: "Running the phone thread tests" },
      { at: 145, text: "Typechecking the phone app" },
    ],
    report:
      "The phone reads turns through `readTurn` in `shared/agent-trace.ts`, so its agent rows nest the same way for free.\n\nThe remote protocol already sends `parentId` and `progress` on each `AgentActivity`. A brief or subagent type would be new fields in `shared/remote.ts`. Phone thread tests pass.",
  },
  {
    id: "agent-a11y",
    description: "Review the hover card's a11y",
    type: "general-purpose",
    model: "Sonnet 5",
    brief:
      "Relay will get a hover card listing running subagents, each row opening that agent's run. Check how base-ui's Popover opens on hover and what keyboard and screen reader users need from it. Recommend, don't edit.",
    start: 66,
    end: 150,
    steps: [
      {
        at: 2,
        kind: "read",
        label: p(
          "node_modules/@base-ui/react/popover/trigger/PopoverTrigger.d.ts",
        ),
      },
      { at: 11, kind: "search", label: `openOnHover in ${p("src")}` },
      {
        at: 19,
        text: "Nothing in Relay opens on hover yet. base-ui's Popover can, with `delay` and `closeDelay`.",
      },
      {
        at: 25,
        kind: "read",
        label: p("src/components/ContextWindowMeter.tsx"),
      },
      {
        at: 39,
        kind: "web",
        label: "tooltip vs disclosure for interactive hover content",
      },
      { at: 55, kind: "read", label: p("src/components/ui.tsx") },
      { at: 69, kind: "search", label: `aria-live in ${p("src")}` },
    ],
    summaries: [
      { at: 6, text: "Reading base-ui's Popover hover props" },
      { at: 32, text: "Checking how Relay popovers handle focus" },
      { at: 60, text: "Checking live regions" },
    ],
    report:
      "Use a Popover with `openOnHover`: a Tooltip can't hold buttons. Focus should open it too, Esc close it, and each row be a button.\n\nKeep the progress lines out of `aria-live`; they change every ~30s and would chatter. The count on the trigger belongs in its label.",
  },
];

type AgentStatus = "waiting" | "running" | "done" | "stopped";

export interface AgentState {
  script: AgentScript;
  status: AgentStatus;
  /** Seconds it has run, or ran. */
  elapsed: number;
  /** Where it ended on the clock, once it has. */
  ended?: number;
  /** Its commentary and calls, for its own run view. */
  trace: AgentTrace[];
  calls: AgentActivity[];
  summary?: string;
}

/** How long a call runs, unless the next step starts sooner. */
const callLength = 3.5;

export function agentAt(
  s: AgentScript,
  t: number,
  stoppedAt?: number,
): AgentState {
  const stop =
    stoppedAt !== undefined && stoppedAt < s.end ? stoppedAt : undefined;
  const end = stop ?? s.end;
  const status: AgentStatus =
    t < s.start
      ? "waiting"
      : t < end
        ? "running"
        : stop !== undefined
          ? "stopped"
          : "done";
  const into = Math.max(0, Math.min(t, end) - s.start);
  const trace: AgentTrace[] = [];
  s.steps.forEach((step, i) => {
    if (step.at > into || status === "waiting") return;
    const id = `${s.id}-${i}`;
    if ("text" in step) {
      trace.push({ kind: "commentary", id, text: step.text });
      return;
    }
    const next = s.steps[i + 1]?.at ?? s.end - s.start;
    const open = into < Math.min(step.at + callLength, next);
    trace.push({
      kind: "activity",
      id,
      activity: {
        id,
        kind: step.kind,
        label: step.label,
        status: !open
          ? "complete"
          : status === "running"
            ? "running"
            : "failed",
        parentId: s.id,
      },
    });
  });
  const calls = trace.flatMap((e) =>
    e.kind === "activity" ? [e.activity] : [],
  );
  return {
    script: s,
    status,
    elapsed: into,
    ended: status === "done" || status === "stopped" ? end : undefined,
    trace,
    calls,
    summary:
      status === "running"
        ? s.summaries.filter((x) => x.at <= into).at(-1)?.text
        : undefined,
  };
}

/**
 * The agents the indicator counts: every one that overlapped the ones still
 * running. It resets once they're all back, so a later fan-out starts at 0.
 */
export function currentBatch(agents: AgentState[], t: number) {
  const started = agents
    .filter((a) => a.status !== "waiting")
    .sort((a, b) => a.script.start - b.script.start);
  let batch: AgentState[] = [];
  let until = -Infinity;
  for (const a of started) {
    if (a.script.start > until) batch = [];
    batch.push(a);
    until = Math.max(until, a.ended ?? t);
  }
  return batch.some((a) => a.status === "running") ? batch : [];
}

const plan = {
  commentary: 3,
  followUp: 62,
};

/** Claude's own turn: its agent rows carry each agent's calls, as the app records them. */
export function mainTurnAt(
  t: number,
  agents: AgentState[],
  realNow: number,
): ChatMessage {
  const trace: AgentTrace[] = [];
  const agentRow = (a: AgentState) => {
    if (a.status === "waiting") return;
    const tools = a.calls.length;
    trace.push({
      kind: "activity",
      id: a.script.id,
      activity: {
        id: a.script.id,
        kind: "agent",
        label: a.script.description,
        status:
          a.status === "running"
            ? "running"
            : a.status === "stopped"
              ? "failed"
              : "complete",
        ...(a.status === "running"
          ? {
              progress: [
                a.summary,
                tools && `${tools} tool${tools === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" · "),
            }
          : {
              detail:
                a.status === "stopped"
                  ? "Stopped from Relay."
                  : a.script.report,
            }),
      },
    });
    for (const call of a.calls)
      trace.push({ kind: "activity", id: call.id, activity: call });
  };
  const [render, sdk, phone, a11y] = agents;
  if (t >= plan.commentary)
    trace.push({
      kind: "commentary",
      id: "main-plan",
      text: "Three things to learn first: where turns render, what the SDK says about subagents, and whether the phone needs changes. One agent each.",
    });
  [render, sdk, phone].forEach((a) => a && agentRow(a));
  if (t >= plan.followUp && render?.status !== "running")
    trace.push({
      kind: "commentary",
      id: "main-follow-up",
      text: "Turns render through `AgentTurn`, and the row above the composer is `.thread-context-controls`. Starting a reviewer on the hover card while the other two finish.",
    });
  if (a11y) agentRow(a11y);

  const back = Math.max(...agents.map((a) => a.ended ?? Infinity));
  const writing = back + 3;
  const finished = back + 10;
  const done = t >= finished;
  const created = realNow - t * 1000;
  return {
    id: "main",
    role: "assistant",
    provider: "claude",
    status: done ? "complete" : "streaming",
    body: done
      ? "All four are back. Relay can show subagents from events it already gets: the SDK's `task_started` brings each agent's brief and type, `task_progress` its summary, and `stopTask` stops one. None of them can take a message from you; Claude can only relay one to an agent it named."
      : t >= writing
        ? "All four are back. Relay can show subagents from events it already gets…"
        : "",
    created,
    ...(done ? { ended: created + finished * 1000 } : {}),
    trace,
    version: 1,
  };
}

/** A subagent's run as a message, so the app's own turn view can draw it. */
export function agentMessage(a: AgentState, realNow: number): ChatMessage {
  const created = realNow - a.elapsed * 1000;
  const live = a.status === "running";
  return {
    id: `run-${a.script.id}`,
    role: "assistant",
    provider: "claude",
    status: live
      ? "streaming"
      : a.status === "stopped"
        ? "cancelled"
        : "complete",
    body: a.status === "done" ? a.script.report : "",
    created,
    ...(live ? {} : { ended: realNow }),
    trace: a.trace,
    version: 1,
  };
}

export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
