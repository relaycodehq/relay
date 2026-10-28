// A thread as a phone gets it: its list entry, tool output cut to its start
// and end, written code left out, both fetched when a row opens, and what each
// call did read here so phones never parse a command.
import type {
  AgentActivity,
  ChatMessage,
  ChatSummary,
} from "../../shared/projects";
import { phoneDetailPreview, type RemoteChatSummary } from "../../shared/remote";
import { isStartThreads } from "../../shared/started-threads";
import { callActions } from "../../shared/call-actions";
import { waitedOn } from "../../shared/waiting";
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

/** What a call wrote, for a phone that opened its row; a file that may hold secrets has only its path, so the phone shows the call's output instead. */
export const writtenForPhone = (call: AgentActivity | undefined) =>
  call?.written?.filter((file) => !file.secret) ?? null;

/** A call with what it did spelled out, and its written code swapped for a mark. */
function forPhoneCall(a: AgentActivity): AgentActivity {
  const { written, ...call } = cutDetail(a);
  return {
    ...call,
    actions: callActions(a),
    ...(written?.some((file) => !file.secret) ? { wroteCode: true as const } : {}),
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

/** A message event as phones get it. */
export const forPhoneEvent = <E extends { message: ChatMessage }>(event: E): E => ({
  ...event,
  message: forPhone(event.message),
});

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

/** A thread's entry in the phone's lists. */
export function summaryForPhone(c: ChatSummary): RemoteChatSummary {
  return {
    id: c.id,
    projectId: c.projectId,
    title: c.title,
    scope: c.scope.kind,
    updated: c.updated,
    created: c.created,
    ...(c.provider ? { provider: c.provider } : {}),
    ...(c.running ? { running: true, runningSince: c.runningSince } : {}),
    ...(c.waiting ? { waiting: true } : {}),
    ...(c.asking ? { asking: true } : {}),
    ...(c.blocked ? { blocked: true } : {}),
    ...(c.settledAt ? { settledAt: c.settledAt } : {}),
    ...(c.settleWhenDone ? { settleWhenDone: c.settleWhenDone } : {}),
    ...(c.autoSettled ? { autoSettled: true } : {}),
    ...(c.markedUnread ? { markedUnread: true } : {}),
    ...(c.seenAt ? { seenAt: c.seenAt } : {}),
    ...(c.snoozedUntil
      ? { snoozedUntil: c.snoozedUntil, snoozedAt: c.snoozedAt }
      : {}),
    ...(c.branch ? { branch: c.branch } : {}),
    ...(c.worktree ? { worktree: true } : {}),
    // Phones show only what Claude waits on; servers list on the desktop.
    ...(c.pending?.length ? { pending: waitedOn(c.pending) } : {}),
    ...(c.nextSend ? { nextSend: c.nextSend } : {}),
    ...(c.queueMark ? { queueMark: c.queueMark } : {}),
    ...(c.empty ? { empty: true } : {}),
    ...(c.goal ? { goal: c.goal } : {}),
    ...(c.startedBy ? { startedBy: c.startedBy } : {}),
    ...(c.reviewer ? { reviewer: true } : {}),
    ...(c.limitResume ? { limitResume: c.limitResume } : {}),
    ...(c.notesMark ? { notesMark: c.notesMark } : {}),
  };
}
