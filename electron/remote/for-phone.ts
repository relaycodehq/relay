// A thread as a phone gets it: tool output cut to its start and end, the rest
// fetched when a fold opens.
import type { AgentActivity, ChatMessage } from "../../shared/projects";
import { phoneDetailPreview } from "../../shared/remote";
import { isStartThreads } from "../../shared/started-threads";
import type { SubagentDetail } from "../../shared/subagents";

export const messageActivity = (m: ChatMessage | undefined): AgentActivity[] =>
  m?.trace
    ? m.trace.flatMap((e) => (e.kind === "activity" ? [e.activity] : []))
    : (m?.activity ?? []);

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

export function forPhone(m: ChatMessage): ChatMessage {
  if (m.trace)
    return {
      ...m,
      trace: m.trace.map((e) =>
        e.kind === "activity" ? { ...e, activity: cutDetail(e.activity) } : e,
      ),
    };
  if (m.activity) return { ...m, activity: m.activity.map(cutDetail) };
  return m;
}

/** An agent's run, its tool output cut as a thread's; the phone has no `activityDetail` for it. */
export function forPhoneRun(run: SubagentDetail): SubagentDetail {
  return {
    ...run,
    trace: run.trace.map((e) => {
      if (e.kind !== "activity") return e;
      const { detailCut: _, ...activity } = cutDetail(e.activity);
      return { ...e, activity };
    }),
  };
}
