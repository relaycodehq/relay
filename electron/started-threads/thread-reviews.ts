import type {
  DeepReviewStart,
  SavedReviewSetup,
} from "../../shared/deep-review";
import type { ProjectChat } from "../../shared/projects";
import type { RelayToolArgs } from "../relay-mcp";
import { json } from "./tool-output";

/** Deep reviews an agent starts in its own thread. */
export interface ThreadReviews {
  /** The deep review sheet's setups, last run first. */
  setups(): SavedReviewSetup[];
  /** Starts a round while the thread's answer runs; the lead's turn waits for it to end. */
  start(chatId: string, config: DeepReviewStart): Promise<void>;
}

const setupName = (entry: SavedReviewSetup) =>
  entry.name?.trim() ||
  entry.setup.reviewers.map((r) => r.choice.model || r.provider).join(" + ");

export const listReviewSetups = (reviews: ThreadReviews) =>
  json(
    reviews.setups().map((entry) => ({
      name: setupName(entry),
      reviewers: entry.setup.reviewers.map((r) => ({
        agent: r.provider,
        model: r.choice.model || "default",
        effort: r.choice.reasoningEffort,
        ...(r.prompt?.trim() ? { prompt: r.prompt.trim() } : {}),
      })),
      runChecks: entry.setup.runChecks,
    })),
  );

/**
 * A round in `lead`'s thread, led by the agent and settings its answer runs
 * on, with the reviewers of the setup it names or the one run last.
 */
export async function startReview(
  reviews: ThreadReviews,
  lead: ProjectChat,
  input: RelayToolArgs<"deep_review">,
) {
  const setups = reviews.setups();
  if (!setups.length)
    throw new Error(
      "No review setup is saved yet. Ask the user to run a deep review once from the deep review sheet.",
    );
  const wanted = input.setup?.toLowerCase();
  const entry = wanted
    ? setups.find((e) => setupName(e).toLowerCase() === wanted)
    : setups[0];
  if (!entry)
    throw new Error(
      `There's no review setup named ${JSON.stringify(input.setup)}. These are: ${setups.map((e) => JSON.stringify(setupName(e))).join(", ")}.`,
    );
  const sent = lead.lastInput;
  if (!sent?.provider || !sent.choice)
    throw new Error("This thread hasn't answered yet, so it can't lead a review.");
  await reviews.start(lead.id, {
    target: input.target ?? { kind: "uncommitted" },
    reviewers: entry.setup.reviewers,
    lead: { provider: sent.provider, choice: sent.choice },
    runChecks: entry.setup.runChecks,
    focus: input.focus ?? "",
    runtimeMode: sent.runtimeMode,
  });
  return `Started ${entry.setup.reviewers.length} reviewers with "${setupName(entry)}". End your answer now: their reports come to you in this thread as your next turn.`;
}
