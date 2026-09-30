import type { Discussion, Review, ReviewComment } from "../../shared/types";

export type TimelineEntry =
  | { kind: "review"; review: Review; comments: ReviewComment[] }
  | { kind: "comment"; comment: Discussion };

// A verdict says something even without a body; a bare COMMENT or
// REQUEST_REVIEW review does not.
const verdicts = new Set(["APPROVED", "REQUEST_CHANGES"]);

/**
 * The PR conversation in the order it happened. Gitea files every single
 * line comment as its own body-less COMMENT review, so a review's line
 * comments are shown inside it and reviews left with nothing to show are
 * dropped.
 */
export function conversationTimeline(
  reviews: Review[],
  comments: ReviewComment[],
  discussion: Discussion[],
): TimelineEntry[] {
  const byReview = new Map<number, ReviewComment[]>();
  for (const c of comments) {
    const list = byReview.get(c.pull_request_review_id) ?? [];
    list.push(c);
    byReview.set(c.pull_request_review_id, list);
  }
  const entries: { at: number; entry: TimelineEntry }[] = [];
  for (const review of reviews) {
    const own = (byReview.get(review.id) ?? []).sort(
      (a, b) => time(a.created_at) - time(b.created_at),
    );
    if (!review.body?.trim() && !own.length && !verdicts.has(review.state))
      continue;
    entries.push({
      at: time(review.submitted_at || own[0]?.created_at),
      entry: { kind: "review", review, comments: own },
    });
  }
  for (const comment of discussion)
    entries.push({
      at: time(comment.created_at),
      entry: { kind: "comment", comment },
    });
  return entries.sort((a, b) => a.at - b.at).map((e) => e.entry);
}

/** Undated items sort last rather than poisoning the comparison. */
function time(value: string | undefined) {
  const t = value ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

export function reviewStateLabel(state: string) {
  switch (state) {
    case "APPROVED":
      return "approved";
    case "REQUEST_CHANGES":
      return "requested changes";
    case "PENDING":
      return "pending review";
    default:
      return "commented";
  }
}
