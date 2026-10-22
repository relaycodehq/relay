import {
  REVIEW_SETUP_NAME_MAX,
  type DeepReviewStart,
  type SavedReviewSetup,
} from "../../shared/deep-review";
import type { ProjectChat } from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import type { RelayToolArgs } from "../relay-mcp";
import { json } from "./tool-output";

/** Deep reviews an agent starts in its own thread. */
export interface ThreadReviews {
  /** The deep review sheet's setups, last run first. */
  setups(): SavedReviewSetup[];
  /** Starts a round while the thread's answer runs; the lead's turn waits for it to end. */
  start(chatId: string, config: DeepReviewStart): Promise<void>;
}

/** Each setup with the name agents pick it by; one two setups would share gets a number. */
function namedSetups(setups: SavedReviewSetup[]) {
  const taken = new Set<string>();
  return setups.map((entry) => {
    const base =
      entry.name?.trim() ||
      entry.setup.reviewers
        .map((r) => r.choice.model || r.provider)
        .join(" + ");
    // Short enough to pass back to deep_review, the number included.
    const fit = (suffix = "") =>
      `${base.slice(0, REVIEW_SETUP_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
    let name = fit();
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = fit(` (${n})`);
    taken.add(name.toLowerCase());
    return { entry, name };
  });
}

export const listReviewSetups = (reviews: ThreadReviews) =>
  json(
    namedSetups(reviews.setups()).map(({ entry, name }) => ({
      name,
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
 * The round `lead`'s thread asks for: led by the agent and settings its
 * answer runs on, with the reviewers of the setup it names or the one run
 * last.
 */
export function reviewRound(
  reviews: ThreadReviews,
  lead: ProjectChat,
  input: RelayToolArgs<"deep_review">,
): { name: string; config: DeepReviewStart } {
  const setups = namedSetups(reviews.setups());
  if (!setups.length)
    throw new Error(
      "No review setup is saved yet. Ask the user to run a deep review once from the deep review sheet.",
    );
  const wanted = input.setup?.toLowerCase();
  const picked = wanted
    ? setups.find((s) => s.name.toLowerCase() === wanted)
    : setups[0];
  if (!picked)
    throw new Error(
      `There's no review setup named ${JSON.stringify(input.setup)}. These are: ${setups.map((s) => JSON.stringify(s.name)).join(", ")}.`,
    );
  const sent = lead.lastInput;
  if (!sent?.choice)
    throw new Error(
      "This thread hasn't answered yet, so it can't lead a review.",
    );
  const { setup } = picked.entry;
  return {
    name: picked.name,
    config: {
      target: input.target ?? { kind: "uncommitted" },
      reviewers: setup.reviewers,
      // The agent the message went to, which an @mention picks over the picker's.
      lead: { provider: sentAgent(sent), choice: sent.choice },
      runChecks: setup.runChecks,
      focus: input.focus ?? "",
      runtimeMode: sent.runtimeMode,
    },
  };
}
