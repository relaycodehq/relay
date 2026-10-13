import { reviewerPrompt, type ReviewAgent } from "../../../shared/deep-review";
import { traitsName } from "./useAgentName";

const clip = (text: string) =>
  text.length > 40 ? text.slice(0, 40) + "…" : text;

/**
 * One reviewer as "2. GPT-5.5 · High · prompt", numbered so two reviewers on
 * the same model and effort still tell apart.
 */
export function reviewerLabel(
  reviewer: ReviewAgent,
  model: string,
  slot: number,
) {
  const asked = reviewerPrompt(reviewer.provider, reviewer.prompt);
  const prompt = clip(asked.kind === "custom" ? asked.text : asked.note);
  return [`${slot}. ${model}`, traitsName(reviewer), prompt]
    .filter(Boolean)
    .join(" · ");
}
