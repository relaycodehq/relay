// What runs beside a turn's answer: the side check that leaves watch notes,
// and the guess at the user's next message asked on the same session.
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import type { AgentPredict, AgentWatch } from "../agents/types";
import type { ChatCore } from "./core";
import type { TurnState } from "./turn-state";

/**
 * The side check, on the thread's own turns: those Claude starts when a
 * background subagent ends too. Claude asks beside its live session, Codex
 * and OpenCode in a throwaway fork of the thread, as Codex's /side does.
 */
export function watchFor(
  core: ChatCore,
  { chat, turn, rules, answer, provider }: TurnState,
) {
  const scope = core.prefs().watchThreads;
  const known = core.store.get().watchKnown ?? [];
  const agentCanWatch =
    provider === "claude" || provider === "codex" || provider === "opencode";
  // An answer in the thread, or one Relay adopted, not a compaction or a /btw side question.
  const threadAnswer =
    (turn.kind === "reply" || turn.kind === "adopt") && !rules.side;
  const isReviewer = !!chat.reviewer;
  if (scope === "off" || !agentCanWatch || !threadAnswer || isReviewer) return;
  const threadNotes = chat.messages.flatMap((m) => m.notes ?? []);
  return {
    scope,
    known,
    shown: threadNotes.map((n) => `${n.title}: ${n.line}`),
    // Older notes don't carry the flag; their title in the known list says it.
    topics: threadNotes
      .filter((n) => n.known || (n.closed && known.includes(n.title)))
      .map((n) => `${n.title}: ${n.line}`),
    onNote: (note) => answer.note(note),
    onSpend: (spend) => core.watchSpend?.add(chat.id, spend),
  } satisfies AgentWatch;
}

/** A message sent past a guess the composer showed counts for or against guessing. */
export function judgeGuess(
  core: ChatCore,
  { chat, turn, rules, input, replyTo }: TurnState,
) {
  if (turn.kind !== "reply" || replyTo || rules.side) return;
  const at = chat.messages.findIndex((m) => m.id === input.id);
  const before = chat.messages
    .slice(0, Math.max(0, at))
    .reverse()
    .find((m) => !m.parentId && !m.side);
  if (
    at >= 0 &&
    before?.role === "assistant" &&
    before.prediction &&
    before.predictionSeen
  )
    core.predictions?.sent(chat.id, before.prediction, chat.messages[at]!.body);
}

/** A guess at the next message, asked on the same session as the check. */
export function predictFor(
  core: ChatCore,
  { chat, turn, rules, answer, provider, replyTo }: TurnState,
): AgentPredict | undefined {
  const predictionsOn = !!core.store.get().composerPredictions;
  const agentCanGuess = provider === "claude" || provider === "codex";
  // A plain answer in the main conversation: not a compaction, a /btw side question or a reply thread.
  const normalAnswer = turn.kind === "reply" && !rules.side && !replyTo;
  // Reviewers and threads another agent started have nobody at the composer.
  const someoneAtComposer = !chat.reviewer && !chat.startedBy;
  if (!predictionsOn || !agentCanGuess || !normalAnswer || !someoneAtComposer)
    return;
  return {
    request: turn.request ?? "",
    allows: () =>
      !nextMoveIsSet(answer.message, chat) &&
      // Guesses nobody sends back off to one turn in ten.
      (core.predictions?.backoffAllows() ?? true),
    onPrediction: (text) => answer.predict(text),
    onAsked: (asked) => core.predictions?.asked(chat.id, asked),
  };
}

/** The user's next move is already decided, so a guessed message would be in the way. */
function nextMoveIsSet(answer: ChatMessage, chat: ProjectChat) {
  const planWaiting = !!answer.proposedPlan;
  const questionWaiting = !!answer.questions?.some(
    (q) => !q.answers && !q.answerMessageId && !q.dismissed,
  );
  // A queued message goes out next anyway.
  const queuedMessageNext =
    !chat.queuePaused &&
    !!chat.queue?.some((q) => !q.compact && !q.input.parentId && !q.input.side);
  return planWaiting || questionWaiting || queuedMessageNext;
}
