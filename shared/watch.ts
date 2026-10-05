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
  /** Closed with "I know this": the thread's checks skip its whole topic. */
  known?: true;
  /** How it was closed; notes closed before this was kept have none. */
  how?: WatchClose;
  /** Learn more was open when it closed. */
  read?: true;
};

/**
 * How a note leaves its turn: with the X, with Tell (it went into the composer
 * as a message for the agent), or with "I know this".
 */
export const watchCloses = ["dismissed", "told", "known"] as const;
export type WatchClose = (typeof watchCloses)[number];

/** How many "I know this" topics the watcher keeps passing on. */
export const WATCH_KNOWN_LIMIT = 50;

/** Tokens by how Claude bills them. */
export type WatchTokens = {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
};

/**
 * What the watcher spent, as Claude Code's own running totals tell it: one
 * side check, or how far a watched thread's session moved, checks included.
 * Dollars are at API list prices; a subscription pays in plan usage instead.
 * Claude and Codex threads both report it.
 */
export type WatchSpend =
  | {
      kind: "check";
      about: "main" | "subagent";
      model: string;
      tokens: WatchTokens;
      /** Absent for a model Relay has no list price for. */
      usd?: number;
      /** The thread made requests of its own during the check; they were taken out and the dollars split by tokens. */
      split?: true;
      noted: boolean;
    }
  | { kind: "thread"; usd: number };

/** One watched thread's share, for the detailed view. */
export type WatchSpendThread = {
  chatId: string;
  title: string;
  /** Checks on a model Relay has no price for; counted in tokens only. */
  unpriced: number;
  checks: number;
  notes: number;
  usd: number;
  /** Everything the thread's sessions spent while watched, checks included. */
  threadUsd: number;
  tokens: WatchTokens;
  split: number;
  subagentChecks: number;
};

/** The last `days` of side checks, as Settings shows them. */
export type WatchSpendSummary = {
  days: number;
  checks: number;
  notes: number;
  usd: number;
  threadUsd: number;
  threads: WatchSpendThread[];
};

/**
 * A second opinion on a note that was shown, from how its thread went on.
 * Development builds only: it tells us how often the checker is worth it.
 */
export type WatchVerdict = {
  noteId: string;
  at: number;
  /** Whether it deserved the interruption. */
  worth: "yes" | "marginal" | "no";
  /**
   * What came after: the agent got there by itself, the person raised it
   * without using the note, the note was acted on, nobody came back to it,
   * or the thread ended before there was anything to go by.
   */
  later: "agent" | "user" | "note" | "never" | "unknown";
  why: string;
};

/** One shown note with what the person did with it. */
export type WatchReviewNote = {
  chatId: string;
  thread: string;
  id: string;
  title: string;
  line: string;
  created: number;
  /** "closed" is from before the way was kept: dismissed or told. */
  action: WatchClose | "open" | "closed";
  read: boolean;
  verdict?: WatchVerdict;
  /** Not judged yet, and its thread has gone on far enough to judge it. */
  ready: boolean;
};

export type WatchReview = { days: number; notes: WatchReviewNote[] };
