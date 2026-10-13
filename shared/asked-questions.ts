import type { AgentActivity } from "./projects";

/** Claude's AskUserQuestion call: its card asked you, and its result says
 * what you picked. */
export const isQuestionCall = (a: AgentActivity) =>
  a.kind === "tool" && a.label === "AskUserQuestion";

export interface AskedQuestion {
  question: string;
  answer: string;
}

// `"Question"="Answer"`, up to the next pair, the closing sentence or the end.
const PAIR = /"([^"]+?)"="([\s\S]*?)"(?=, "[^"]+?"="|\.(?:\s|$)|$)/g;

/**
 * The questions a finished AskUserQuestion call asked and what you answered,
 * read from the result Claude Code wrote for it (`The user answered:
 * "Q"="A", …`). Absent when there's nothing to read, like a declined card.
 */
export function askedQuestions(a: AgentActivity): AskedQuestion[] | undefined {
  if (!isQuestionCall(a) || a.status !== "complete" || !a.detail) return;
  const pairs = [...a.detail.matchAll(PAIR)].map(([, question, answer]) => ({
    question: question!.trim(),
    answer: answer!.trim(),
  }));
  return pairs.length ? pairs : undefined;
}
