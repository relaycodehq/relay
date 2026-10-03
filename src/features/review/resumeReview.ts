import type { Api, Pull, Review } from "../../../shared/types";

/** Check fresh server state only when reopening a saved workspace. Manual opens still work. */
export async function shouldResumeReview(
  pull: Pull,
  userId: number,
  loadReviews: Api["reviews"],
): Promise<boolean> {
  if (pull.state !== "open" || pull.merged) return false;
  let latest: Review | undefined;
  for (let page: number | null = 1, count = 0; page !== null;) {
    if (++count > 40)
      throw new Error(
        "Could not check the complete review history. Open this PR from the list or retry.",
      );
    const result = await loadReviews(pull, page);
    for (const review of result.items) {
      if (
        review.user?.id !== userId ||
        !["APPROVED", "REQUEST_CHANGES", "REQUEST_REVIEW"].includes(
          review.state,
        )
      )
        continue;
      const date = Date.parse(review.submitted_at),
        previous = latest && Date.parse(latest.submitted_at);
      if (
        !latest ||
        (Number.isFinite(date) && Number.isFinite(previous) && date !== previous
          ? date > previous!
          : review.id > latest.id)
      )
        latest = review;
    }
    page = result.nextPage;
  }
  return (
    !latest ||
    latest.state !== "APPROVED" ||
    !!latest.dismissed ||
    !!latest.stale ||
    latest.commit_id !== pull.head.sha
  );
}
