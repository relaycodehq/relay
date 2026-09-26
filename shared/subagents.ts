// Subagents Claude started in a thread, as the composer's indicator, its card
// and an agent's side thread show them. The main process follows them from
// the SDK's task events while the session lives; none of this is saved.
import type { AgentActivity, AgentTrace } from "./projects";

export type SubagentStatus = "running" | "completed" | "failed" | "stopped";

export interface SubagentRun {
  /** The Agent tool call that started it. */
  id: string;
  description: string;
  /** Its agent type, e.g. "Explore" or "general-purpose". */
  type?: string;
  model?: string;
  /** The prompt Claude wrote for it. */
  brief?: string;
  status: SubagentStatus;
  started: number;
  ended?: number;
  /** Its latest ~30s progress summary, while it runs. */
  summary?: string;
  /** Tool calls so far. */
  calls: number;
  /** The last few, newest last. */
  recent: AgentActivity[];
  /** The start of what it reported back, once it's done. */
  outcome?: string;
  /** The agent that started this one, when an agent did. */
  parentId?: string;
}

/** An agent's whole run, for its side thread. */
export interface SubagentDetail extends SubagentRun {
  /** Its text and calls, in order; the report isn't repeated here. */
  trace: AgentTrace[];
  /** What it handed back to Claude. */
  report?: string;
}

/** Runs that overlapped in time, oldest first: one fan-out each. */
export function subagentBatches(runs: SubagentRun[], now = Date.now()) {
  const batches: SubagentRun[][] = [];
  let until = -Infinity;
  for (const run of [...runs].sort((a, b) => a.started - b.started)) {
    if (run.started > until) batches.push([]);
    batches.at(-1)!.push(run);
    const end = run.status === "running" ? now : (run.ended ?? run.started);
    until = Math.max(until, end);
  }
  return batches;
}

/**
 * What the indicator counts: every agent that overlapped the ones still
 * running. It empties once they're all back, so the next fan-out starts at 0.
 */
export function runningBatch(runs: SubagentRun[], now = Date.now()) {
  const last = subagentBatches(runs, now).at(-1) ?? [];
  return last.some((r) => r.status === "running") ? last : [];
}

/** The fan-out an agent belongs to, for its side thread's tabs. */
export function batchOf(runs: SubagentRun[], id: string, now = Date.now()) {
  return (
    subagentBatches(runs, now).find((batch) =>
      batch.some((r) => r.id === id),
    ) ?? []
  );
}

/** "claude-opus-5-5" reads "Opus 5.5"; an alias like "haiku" reads "Haiku". */
export function modelName(model: string) {
  const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const id =
    /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[1m\])?$/.exec(model);
  if (id) return `${cap(id[1]!)} ${id[2]}${id[3] ? `.${id[3]}` : ""}`;
  return /^[a-z]+$/.test(model) ? cap(model) : model;
}
