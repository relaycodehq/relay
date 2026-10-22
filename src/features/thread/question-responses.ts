import type { ChatMessage } from "../../../shared/projects";

export interface QuestionResponse {
  parts: ChatMessage[];
  /** Only the heading uses this combined trace; each part keeps its own content and file links. */
  summary: ChatMessage;
  /** Time spent in earlier turns, excluding the time waiting for an answer. */
  elapsed: number;
  waiting: boolean;
}

const isAnswer = (m: ChatMessage) =>
  m.role === "assistant" &&
  !m.side &&
  !m.compaction &&
  !m.handoff &&
  !m.reload &&
  !m.worktreeCommand;

/** A saved question reply can start another backend turn in the same visible response. */
export function questionResponses(
  messages: ChatMessage[],
  previous?: ReadonlyMap<string, QuestionResponse>,
) {
  const owners = new Map(
    messages.flatMap((m) =>
      (m.questions ?? []).flatMap((q) =>
        q.answerMessageId ? [[q.answerMessageId, m] as const] : [],
      ),
    ),
  );
  const groups: ChatMessage[][] = [];
  let current: ChatMessage[] | undefined;
  let reply: ChatMessage | undefined;
  for (const m of messages) {
    if (m.role === "user" && (m.asyncQuestionAnswer || m.pageAnswer)) {
      const owner = m.questionMessageId
        ? current?.find(
            (part) => part.id === m.questionMessageId && part.questions?.length,
          )
        : owners.get(m.id);
      reply = !m.missed && owner && current?.includes(owner) ? m : undefined;
      continue;
    }
    if (!isAnswer(m)) {
      current = undefined;
      reply = undefined;
      continue;
    }
    const previous = current?.at(-1);
    if (
      reply &&
      previous?.status === "complete" &&
      !m.unprompted &&
      m.provider === previous.provider &&
      m.provider === reply.provider &&
      (m.parentId ?? null) === (previous.parentId ?? null) &&
      (m.parentId ?? null) === (reply.parentId ?? null)
    ) {
      current!.push(m);
    } else {
      current = [m];
      groups.push(current);
    }
    reply = undefined;
  }
  const result = new Map<string, QuestionResponse>();
  for (const parts of groups) {
    if (!parts.some((m) => m.questions?.length)) continue;
    const last = parts.at(-1)!;
    const waiting =
      parts === current &&
      last.status === "complete" &&
      !!last.questions?.some((q) => !q.answers && !q.dismissed);
    const held = previous?.get(parts[0]!.id);
    if (
      held &&
      held.waiting === waiting &&
      held.parts.length === parts.length &&
      parts.every((part, index) => part === held.parts[index])
    ) {
      for (const part of parts) result.set(part.id, held);
      continue;
    }
    const traceDropped: ChatMessage["traceDropped"] = {};
    for (const part of parts)
      for (const [kind, count] of Object.entries(part.traceDropped ?? {})) {
        const key = kind as keyof typeof traceDropped;
        traceDropped[key] = (traceDropped[key] ?? 0) + count;
      }
    const response: QuestionResponse = {
      parts,
      summary: {
        ...last,
        id: parts[0]!.id,
        trace: parts.flatMap(
          (m) =>
            m.trace ??
            (m.activity ?? []).map((activity) => ({
              kind: "activity" as const,
              id: activity.id,
              activity,
            })),
        ),
        traceDropped,
      },
      elapsed: parts.slice(0, -1).reduce(
        // A live steer backdates its new segment to the reply; those intervals overlap.
        (time, m, index) =>
          time +
          Math.max(
            0,
            Math.min(m.ended ?? m.created, parts[index + 1]!.created) -
              m.created,
          ),
        0,
      ),
      waiting,
    };
    for (const part of parts) result.set(part.id, response);
  }
  return result;
}
