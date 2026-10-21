// The composer's guess at the next message: what asking for one spent, and
// how often what was sent next was the guess.
import type { UsageTokens } from "./usage";

/** One guess asked for after a turn; `offered` when it came back as a message, not an abstention. */
export type PredictionAsked = {
  offered: boolean;
  /** What the question cost, when its agent could measure it. */
  cost?: { model: string; tokens: UsageTokens; usd?: number };
};

/** The last `days` of guesses, for the line under the setting. */
export type PredictionSummary = {
  days: number;
  asked: number;
  offered: number;
  /** Messages sent while a guess was on offer, and how many of them were the guess as it stood. */
  sentAfter: number;
  taken: number;
  usd: number;
  /** Asked, but their agent couldn't measure what it cost. */
  unmeasured: number;
  /** What the threads that had guesses spent on their own turns, for the share. */
  threadUsd: number;
  /** Guesses went unsent long enough that only one turn in ten gets one. */
  backingOff?: boolean;
};
