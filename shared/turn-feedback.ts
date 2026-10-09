import type { ChatMessage } from "./projects";

/** The buzz a phone gives for the thread on its screen. */
export type TurnFeedback = "success" | "error" | "warning";

/** The open thread at one moment, as far as a buzz cares. */
export interface TurnSight {
  running: boolean;
  /** When the running turn started. */
  since?: number;
  /** A question or an approval is waiting on you. */
  waiting: boolean;
  /** The latest answer. */
  answer?: Pick<ChatMessage, "created" | "status">;
}

export interface TurnWatch {
  running: boolean;
  waiting: boolean;
  since?: number;
  /** A turn that stopped running whose answer hasn't arrived finished yet: when it started. */
  ended?: number;
  /** A finished answer already present at the first look, possibly from a cached thread. */
  ignoredAnswer?: number;
  /** When the turn whose end already buzzed started, so a stale "still running" can't end it twice. */
  told?: number;
}

/**
 * Compares a thread with how it last looked and says what to buzz, once per
 * change: a question appearing, or a turn ending in its answer finishing or
 * failing. With nothing to compare with (opening the thread, reconnecting)
 * it only takes note. A turn's end often arrives before its answer's last
 * state does, so it waits for an answer from that turn that is no longer
 * streaming; a stopped answer gets no buzz. A turn ends once: a list that
 * reports it running again (an overview fetched before it ended, answered
 * after) and then ended doesn't buzz a second time.
 */
export function watchTurn(
  last: TurnWatch | undefined,
  sight: TurnSight,
): { watch: TurnWatch; feedback?: TurnFeedback } {
  const watch: TurnWatch = {
    running: sight.running,
    waiting: sight.waiting,
    since: sight.running ? (sight.since ?? last?.since) : undefined,
    ignoredAnswer: last
      ? last.ignoredAnswer
      : sight.answer?.status !== "streaming"
        ? sight.answer?.created
        : undefined,
    told: last?.told,
  };
  if (!last) return { watch };
  const asked = sight.waiting && !last.waiting;
  let ended = sight.running
    ? undefined
    : last.running
      ? last.since
      : last.ended;
  if (ended !== undefined && ended === last.told) ended = undefined;
  let end: TurnFeedback | undefined;
  const answer = sight.answer;
  if (
    ended !== undefined &&
    answer &&
    answer.created >= ended &&
    answer.created !== watch.ignoredAnswer &&
    answer.status !== "streaming"
  ) {
    if (answer.status === "complete") end = "success";
    if (answer.status === "failed") end = "error";
    watch.told = ended;
    ended = undefined;
  }
  return {
    watch: ended === undefined ? watch : { ...watch, ended },
    feedback: asked ? "warning" : end,
  };
}
