// A thread's turns as the desktop, the phone and the headless Relay all read
// them; see docs/turn-lifecycle.md.
import type { AgentProvider } from "./agents";

/**
 * What a turn is for. `answer` replies to a message, `adopt` is one the agent
 * started by itself, `lead` is a deep review's first answer, `handoff` the
 * outgoing agent's note for the next, `aside` a `/btw` answer.
 */
export type TurnKind =
  "answer" | "adopt" | "lead" | "compaction" | "handoff" | "aside";

/**
 * `starting`: the thread is held, no agent runs yet. `finishing`: the answer
 * is written and saved. `stopping`: stopped, the agent winds down.
 */
export type TurnPhase =
  "starting" | "running" | "finishing" | "stopping" | "ended";

/**
 * How a turn ended. `unstarted`: stopped or failed before its agent ran.
 * `interrupted`: Relay quit under it and nothing picked it back up. `lost`:
 * it ended without saying so, which the ledger's check caught.
 */
export type TurnEnd =
  "completed" | "failed" | "cancelled" | "unstarted" | "interrupted" | "lost";

export interface Turn {
  id: string;
  threadId: string;
  kind: TurnKind;
  provider: AgentProvider;
  phase: TurnPhase;
  /** The turn it serves, e.g. the answer a handoff note briefs. */
  parentTurnId?: string;
  /** The message it writes into, once it has one. */
  answerId?: string;
  startedAt: number;
  endedAt?: number;
  endedAs?: TurnEnd;
}

/** Something that happened to a turn, numbered in the order it happened. */
export interface TurnEvent {
  seq: number;
  at: number;
  type: "opened" | "phase" | "ended";
  turn: Turn;
}

/** The turn that holds a thread now, as its list entry says. */
export type OpenTurn = Pick<Turn, "id" | "kind" | "phase" | "startedAt">;

/** Kinds whose end is an answer someone may want to hear about. */
export const answersKinds: readonly TurnKind[] = ["answer", "adopt", "lead"];

/** The phases in which a turn's agent works and the thread reads running. */
export const working = (phase: TurnPhase) =>
  phase === "starting" || phase === "running" || phase === "finishing";
