import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  revisionOf,
  type ChangedFile,
  type Progress,
  type Pull,
} from "../../shared/types";
import { api } from "./api";
import { reviewOrder } from "./review-order";
import type { PullSelection } from "./usePullSelection";
import type { ReviewTriage } from "./useReviewTriage";

/**
 * A PR's changed files, a page at a time unless the analysis lists them all,
 * in the order the review goes through them. The open file falls back to the
 * first one once the one asked for turns out not to be there.
 */
export function useReviewFiles(
  { selected, restoring, file, setFile, navigation }: PullSelection,
  pull: Pull | undefined,
  { result, groups, plain }: ReviewTriage,
  onError: (e: unknown) => void,
) {
  const [filter, setFilter] = useState("");
  const files = useInfiniteQuery({
    queryKey: ["files", selected, pull?.head.sha],
    queryFn: ({ pageParam }) => api.files(selected!, pageParam),
    initialPageParam: 1,
    getNextPageParam: (p) => p.nextPage ?? undefined,
    enabled: !!pull && !restoring,
  });
  useEffect(() => {
    if (!result && filter && files.hasNextPage && !files.isFetchingNextPage)
      void files.fetchNextPage();
  }, [filter, files.hasNextPage, files.isFetchingNextPage, files.data]);
  const all = useMemo(
    () => result?.files ?? files.data?.pages.flatMap((p) => p.items) ?? [],
    [files.data, result],
  );
  const order = useMemo(
    () => reviewOrder(all, groups, plain),
    [all, groups, plain],
  );
  useEffect(() => {
    if (!result && !files.data) return;
    if (file && all.some((f) => f.filename === file)) return;
    // A restored file may be on a later metadata page. Do not mount/fetch the
    // first diff while finding it, or overwrite its saved selection early.
    if (file && !result) {
      if (files.isFetching || files.isError) return;
      if (files.hasNextPage) {
        void files.fetchNextPage();
        return;
      }
    }
    setFile(all[0]?.filename ?? null);
  }, [
    all,
    file,
    result,
    files.data,
    files.hasNextPage,
    files.isFetching,
    files.isError,
  ]);
  /**
   * Opens the next file unviewed in `progress` after `path`, then any before
   * it. Past the loaded pages it loads more, metadata only.
   */
  const advanceUnread = async (
    path: string,
    progress: Progress,
    reveal = true,
  ) => {
    const request = ++navigation.current;
    const revision = pull ? revisionOf(pull) : "";
    const unread = (entry: ChangedFile) =>
      progress.read[entry.filename] !== revision;
    let loaded = order;
    const start = loaded.findIndex((entry) => entry.filename === path) + 1;
    let next = loaded.slice(start).find(unread);
    let hasMore = !result && files.hasNextPage;
    try {
      while (!next && hasMore) {
        const page = await files.fetchNextPage({ cancelRefetch: false });
        if (request !== navigation.current) return;
        if (page.isError) throw page.error;
        const previousCount = loaded.length;
        loaded = page.data?.pages.flatMap((p) => p.items) ?? loaded;
        hasMore = page.hasNextPage;
        if (hasMore && loaded.length <= previousCount)
          throw new Error(
            "Could not load the next files. Try loading more from the file list.",
          );
        next = loaded.slice(start).find(unread);
      }
      // At the end, pick up any earlier unread files; stop once the review is complete.
      next ??= loaded.slice(0, start - 1).find(unread);
      if (next && request === navigation.current)
        setFile(next.filename, reveal);
    } catch (error) {
      if (request === navigation.current) onError(error);
    }
  };
  return {
    query: files,
    /** What the file list is filtered by; filtering loads every page. */
    filter,
    setFilter,
    all,
    order,
    advanceUnread,
  };
}
export type ReviewFiles = ReturnType<typeof useReviewFiles>;
