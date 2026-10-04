/**
 * "Flag what I'd miss": a side check beside a running Claude thread that
 * points out what the person would likely miss, subagents' work included.
 */

/** How far it looks: not at all (the default), the main thread, or its subagents too. */
export const watchScopes = ["off", "main", "subagents"] as const;
export type WatchScope = (typeof watchScopes)[number];

export type WatchNote = {
  id: string;
  tag: "Heads up" | "You should know";
  /** The one sentence shown before Learn more. */
  line: string;
  title: string;
  /** Markdown, one point each. */
  points: string[];
  diff?: { file: string; lines: string[] };
  /** What Tell Claude puts in the composer. */
  steer?: string;
  /** The subagent it is about, by its agent call; absent for the thread itself. */
  agent?: { id: string; label: string };
  created: number;
  /** Dismissed, answered with Tell Claude, or known: it stays out of the turn. */
  closed?: true;
};

/** How many "I know this" topics the watcher keeps passing on. */
export const WATCH_KNOWN_LIMIT = 50;
