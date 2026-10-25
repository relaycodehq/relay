// A thread as a phone gets it: tool output cut to its start and end, written
// code left out, both fetched when a row opens, and what each call did read
// here so phones never parse a command.
import type { AgentActivity, ChatMessage } from "../../shared/projects";
import { phoneDetailPreview } from "../../shared/remote";
import { isStartThreads } from "../../shared/started-threads";
import { callActions } from "../../shared/call-actions";
import type { SubagentDetail } from "../../shared/subagents";

const messageActivity = (m: ChatMessage | undefined): AgentActivity[] =>
  m?.trace
    ? m.trace.flatMap((e) => (e.kind === "activity" ? [e.activity] : []))
    : (m?.activity ?? []);

/** A tool call in a thread's message, which phones fetch the cut parts of. */
export function callIn(
  chat: { messages: (ChatMessage | string)[] },
  messageId: string,
  activityId: string,
) {
  const message = chat.messages.find(
    (m): m is ChatMessage => typeof m !== "string" && m.id === messageId,
  );
  return messageActivity(message).find((a) => a.id === activityId);
}

/**
 * Tool output is most of a thread's weight (8.5 of 11.9 MB over 40 real
 * threads), and the phone shows it only in a fold you open; it gets the
 * start and the end, and `activityDetail` the rest when the fold opens.
 */
function cutDetail(a: AgentActivity): AgentActivity {
  const detail = a.detail;
  // The started threads' ids, which a phone needs whole to tell its turn's threads apart.
  if (!detail || detail.length <= phoneDetailPreview || isStartThreads(a))
    return a;
  const half = phoneDetailPreview / 2;
  return {
    ...a,
    detail: `${detail.slice(0, half)}\n…\n${detail.slice(-half)}`,
    detailCut: detail.length - phoneDetailPreview,
  };
}

/** A call with what it did spelled out, and its written code swapped for a mark. */
function forPhoneCall(a: AgentActivity): AgentActivity {
  const { written, ...call } = cutDetail(a);
  return {
    ...call,
    actions: callActions(a),
    ...(written?.length ? { wroteCode: true as const } : {}),
  };
}

export function forPhone(m: ChatMessage): ChatMessage {
  if (m.trace)
    return {
      ...m,
      trace: m.trace.map((e) =>
        e.kind === "activity" ? { ...e, activity: forPhoneCall(e.activity) } : e,
      ),
    };
  if (m.activity) return { ...m, activity: m.activity.map(forPhoneCall) };
  return m;
}

/** An agent's run, its tool output cut as a thread's; the phone has no `activityDetail` for it. */
export function forPhoneRun(run: SubagentDetail): SubagentDetail {
  return {
    ...run,
    trace: run.trace.map((e) => {
      if (e.kind !== "activity") return e;
      // No `activityDetail` or `activityWritten` reaches a subagent's calls.
      const { detailCut: _, wroteCode: __, ...activity } = forPhoneCall(e.activity);
      return { ...e, activity };
    }),
  };
}
