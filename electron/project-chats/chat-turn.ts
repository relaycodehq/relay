import type { ChatMessage } from "../../shared/projects";
import type { CodexSkill } from "../agents/provider-commands";

/** Why an agent runs a turn in a thread; each kind follows its own rules. */
export type ChatTurn =
  /** Answers a message sent in the thread. */
  | {
      kind: "reply";
      skills?: CodexSkill[];
      /** The prompt told the session everything it hadn't heard yet. */
      caughtUp?: boolean;
      /** Crosses off what the prompt told the agent, once the turn didn't fail. */
      briefed?: () => void;
    }
  /** The outgoing agent writes a note for the one taking over. */
  | { kind: "handoff" }
  /**
   * A turn the agent started itself, or one a restart cut off, which carries
   * on in `resumed`, the answer it was writing.
   */
  | { kind: "adopt"; resumed?: ChatMessage }
  /** A `/btw` question in a read-only fork, beside the main answer. */
  | { kind: "side" }
  /** Compacts the session; the summary goes beside an empty answer. */
  | { kind: "compact" };

/** What a turn of this kind does around the agent's run. */
export function turnRules(turn: ChatTurn) {
  const { kind } = turn;
  return {
    /** The model the turn runs on is shown on the answer. */
    showsModel: kind !== "compact",
    /** The turn's file changes are recorded: side turns change nothing, a compaction edits nothing. */
    records: kind !== "compact" && kind !== "side",
    /** Picks the changes up from the snapshot taken before a restart. */
    resumesSnapshot: kind === "adopt" && !!turn.resumed,
    /** Runs read-only in a fork of the main session. */
    side: kind === "side",
    /**
     * A failed answer the user asked for pauses the queue behind it. A
     * restart resumes whatever was streaming, so the message decides.
     */
    pausesQueue: (message: ChatMessage) =>
      kind !== "side" && !message.handoff && !message.unprompted,
    /**
     * The session has heard the conversation up to this answer, unless the
     * turn told it nothing new (a handoff note, a compaction, a command
     * that went out alone): then it still has to hear what came after its
     * last answer, such as a question asked of another agent.
     */
    advancesSession: (message: ChatMessage) =>
      kind !== "compact" &&
      !message.handoff &&
      (kind !== "reply" || turn.caughtUp !== false),
    /** A thread's first answer names it. */
    titles: kind !== "compact",
    /** A deep reviewer's Codex review applies to its own turns only. */
    reviews: kind !== "compact" && kind !== "adopt",
  };
}
