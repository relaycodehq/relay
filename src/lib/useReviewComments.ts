import { useEffect } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Pull, ReviewComment } from "../../shared/types";
import { api } from "./api";

/**
 * A PR's reviews and their line comments, all pages of them. Reports the
 * paths with unresolved comments, which the review keeps out of groups.
 */
export function useReviewComments(
  pull: Pull,
  onCommentPaths: (paths: string[]) => void,
) {
  const reviews = useInfiniteQuery({
    queryKey: ["reviews", pull.owner, pull.name, pull.number, pull.head.sha],
    queryFn: ({ pageParam }) => api.reviews(pull, pageParam),
    initialPageParam: 1,
    getNextPageParam: (p) => p.nextPage ?? undefined,
  });
  // Review metadata is small; page it fully so line discussions cannot silently disappear.
  useEffect(() => {
    if (reviews.hasNextPage && !reviews.isFetchingNextPage)
      void reviews.fetchNextPage();
  }, [reviews.hasNextPage, reviews.isFetchingNextPage, reviews.data]);
  const all = reviews.data?.pages.flatMap((p) => p.items) ?? [];
  const comments = useQuery({
    queryKey: [
      "reviewComments",
      pull.owner,
      pull.name,
      pull.number,
      all.map((r) => r.id),
    ],
    queryFn: async () => {
      const result: ReviewComment[] = [];
      // Bound concurrency: large histories never fire hundreds of requests at once.
      for (let i = 0; i < all.length; i += 3) {
        const batch = await Promise.all(
          all
            .slice(i, i + 3)
            .filter((r) => r.comments_count !== 0)
            .map((r) => api.reviewComments(pull, r.id)),
        );
        result.push(...batch.flat());
      }
      return result;
    },
    enabled: reviews.isSuccess && !reviews.hasNextPage,
  });
  useEffect(() => {
    if (comments.data)
      onCommentPaths([
        ...new Set(comments.data.filter((c) => !c.resolver).map((c) => c.path)),
      ]);
  }, [comments.data, onCommentPaths]);
  return { reviews, all, comments };
}
