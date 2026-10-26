// A second opinion on an answer: another agent checks it in a thread of its
// own. It's told a colleague wrote the answer, never that an agent did, nor
// that the user did; either tilts what it says.
import { z } from "zod";
import { agentProviderSchema } from "./agents";
import { truncated } from "./truncate";

// Both fit in one message (32k), with the prompt's own lines around them.
const QUESTION_CHARS = 6_000;
/** The most of an answer, or of an opinion sent back, that a message carries. */
export const ANSWER_CHARS = 24_000;

/** What a second opinion was asked about, as its thread shows it; the agent gets both inside the prompt. */
export const secondOpinionAskedSchema = z
  .object({
    question: z.string().max(QUESTION_CHARS),
    answer: z.string().trim().min(1).max(ANSWER_CHARS),
  })
  .strict();
export type SecondOpinionAsked = z.infer<typeof secondOpinionAskedSchema>;

/** Who gives the second opinion: an agent, and its model ("" for its Default). */
export const secondOpinionAgentSchema = z
  .object({
    provider: agentProviderSchema,
    model: z.string().max(200),
  })
  .strict();
export type SecondOpinionAgent = z.infer<typeof secondOpinionAgentSchema>;

/** The question and answer as a thread keeps them, cut to fit its prompt. */
export const secondOpinionAsked = (
  question: string,
  answer: string,
): SecondOpinionAsked => ({
  question: truncated(question.trim(), QUESTION_CHARS),
  answer: truncated(answer.trim(), ANSWER_CHARS),
});

/** What the agent giving the second opinion is sent. */
export function secondOpinionPrompt({ question, answer }: SecondOpinionAsked) {
  const ask = question
    ? "My colleague answered this question, and I'd like a second opinion."
    : "My colleague wrote this, and I'd like a second opinion.";
  return [
    `${ask} Check it independently: what's wrong, what's missing, or what would you do differently? If it holds up, say so.`,
    ...(question ? [`## Question\n\n${question}`] : []),
    `## Answer\n\n${answer}`,
  ].join("\n\n");
}
