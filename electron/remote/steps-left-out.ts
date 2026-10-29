// A finished turn as a phone first gets it: folded, so its steps stay here
// until the fold opens and `messageSteps` hands them out. The tool calls were
// most of a big thread's weight on a slow link, and nobody saw them unless
// they opened the turn.
import type { AgentActivity, ChatMessage } from "../../shared/projects";
import type { ChatSteps } from "../../shared/remote";
import { looksAtImage, readTurn, turnHeading } from "../../shared/agent-trace";
import { isStartThreads } from "../../shared/started-threads";

/** A call phones show outside the fold: a picture it looked at, or threads it started. */
const shownOutsideFold = (call: AgentActivity) =>
  looksAtImage(call) || isStartThreads(call);

/**
 * The finished turn with its steps left out, or as it is when it has no calls
 * to leave out. It keeps the last call, which the heading's icon is of, and
 * says what the heading reads, so phones needn't count calls they don't have.
 */
export function withStepsLeftOut(message: ChatMessage): ChatMessage {
  const turn = readTurn(message);
  const last = turn.activity.at(-1);
  // No calls: its commentary is all the fold holds.
  if (!last) return message;
  // A subagent's calls too: phones look for pictures and started threads in the whole trace.
  const trace = turn.entries.filter(
    (entry) =>
      entry.kind === "activity" &&
      (entry.activity === last || shownOutsideFold(entry.activity)),
  );
  const stepsLeftOut = turn.entries.length - trace.length;
  if (!stepsLeftOut) return message;
  const heading = turnHeading(message, false, turn);
  const { activity: _, ...rest } = message;
  return {
    ...rest,
    trace,
    stepsLeftOut,
    ...(heading.kind === "done" ? { stepsSummary: heading.text } : {}),
  };
}

/**
 * Where the main conversation's newest turn is; -1 when the phone holds what
 * comes last, so it has that turn already. Replies are conversations of their
 * own, which phones show apart from the main one.
 */
function newestTurnAt(messages: (ChatMessage | string)[]) {
  const ids = new Set(messages.map((m) => (typeof m === "string" ? m : m.id)));
  for (let index = messages.length - 1; index >= 0; index--) {
    const m = messages[index]!;
    if (typeof m === "string") return -1;
    const reply = !!m.parentId && ids.has(m.parentId);
    if (!reply && m.role === "assistant") return index;
  }
  return -1;
}

/**
 * The messages a phone asked for, with `"latest"` every finished turn but the
 * newest folded. The newest is the one most likely opened, so it comes whole.
 */
export function stepsAsAsked<M extends ChatMessage | string>(
  messages: M[],
  steps: ChatSteps = "all",
): (M | ChatMessage)[] {
  if (steps === "all") return messages;
  const newest = newestTurnAt(messages);
  return messages.map((m, index) => {
    if (typeof m === "string" || index === newest) return m;
    const finishedTurn = m.role === "assistant" && m.status !== "streaming";
    return finishedTurn ? withStepsLeftOut(m) : m;
  });
}
