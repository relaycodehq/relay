import { reviewFolder, type ChatSummary } from "../../shared/projects";
import {
  latestReview,
  reviewCard,
  type DeepReviewState,
} from "../../shared/deep-review";

/** What the sidebar shows of a deep review: its checkout, what it covers and whether its reviewers are at work. */
export function reviewSummary(
  reviews: DeepReviewState[] | undefined,
): Pick<ChatSummary, "reviewFolder" | "reviewing" | "reviewCard"> {
  const folder = reviewFolder({ reviews });
  const latest = latestReview({ reviews });
  return {
    ...(folder ? { reviewFolder: folder } : {}),
    ...(latest ? { reviewCard: reviewCard(latest) } : {}),
    ...(latest?.status === "reviewing" ? { reviewing: true as const } : {}),
  };
}
