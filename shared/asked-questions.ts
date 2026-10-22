import type { AgentActivity } from "./projects";
import type { AgentQuestion } from "./agent-modes";

/** A native question call, kept separate from ordinary tool calls. */
export const isQuestionCall = (a: AgentActivity) =>
  a.kind === "tool" &&
  (a.label === "AskUserQuestion" || a.label === "request_user_input");

export interface AskedQuestion {
  question: string;
  answer: string;
}

/** The readable record of a response; secret answers never enter the trace. */
export function questionAnswers(
  questions: AgentQuestion[],
  answers: Record<string, string[]>,
): AskedQuestion[] {
  return questions.map((q) => ({
    question: q.question,
    answer: q.isSecret
      ? "Hidden answer"
      : (answers[q.id]
          ?.map(
            (value) =>
              q.options?.find((o) => o.value === value)?.label ?? value,
          )
          .join(", ") ?? "No answer provided"),
  }));
}

// `"Question"="Answer"`, up to the next pair, the closing sentence or the end.
const PAIR = /"([^"]+?)"="([\s\S]*?)"(?=, "[^"]+?"="|\.(?:\s|$)|$)/g;

/**
 * A finished native call's questions and answers. Codex keeps structured
 * pairs; Claude Code writes them in its result (`The user answered:
 * "Q"="A", …`). Absent when there's nothing to read, like a declined card.
 */
export function askedQuestions(a: AgentActivity): AskedQuestion[] | undefined {
  if (!isQuestionCall(a) || a.status !== "complete") return;
  if (a.questionAnswers?.length) return a.questionAnswers;
  if (!a.detail) return;
  const pairs = [...a.detail.matchAll(PAIR)].map(([, question, answer]) => ({
    question: question!.trim(),
    answer: answer!.trim(),
  }));
  return pairs.length ? pairs : undefined;
}
