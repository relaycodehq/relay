import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAnalyzing, notedPaths } from "../../shared/triage";
import type { Progress, Pull, PullRef } from "../../shared/types";
import { api } from "./api";
import { openGroups } from "./review-order";

/**
 * Grouping a PR's files by the change they make together: the analysis,
 * starting and cancelling it, and its groups without the files that have
 * notes, drafts or open comments. `plain` shows the flat list instead.
 */
export function useReviewTriage(
  selected: PullRef | null,
  pull: Pull | undefined,
  revision: string,
  restoring: boolean,
  progress: Progress,
) {
  const qc = useQueryClient();
  const key = ["triage", selected, revision];
  const triage = useQuery({
    queryKey: key,
    queryFn: () => api.triageState(selected!, pull!.head.sha, pull!.merge_base),
    enabled: !!pull && !restoring,
    refetchInterval: (query) => (isAnalyzing(query.state.data) ? 600 : false),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [plain, setPlain] = useState(false),
    [commentPaths, setCommentPaths] = useState<string[]>([]);
  const result =
    triage.data?.revision === revision ? triage.data.result : undefined;
  const groups = useMemo(
    () =>
      openGroups(
        result?.groups ?? [],
        new Set([...commentPaths, ...notedPaths(progress, revision)]),
      ),
    [result, commentPaths, progress.drafts, progress.marks, revision],
  );
  useEffect(() => {
    setCommentPaths([]);
    setError(undefined);
  }, [revision, selected]);
  const start = async () => {
    if (!pull || !selected) return;
    setBusy(true);
    setError(undefined);
    try {
      const state = await api.startTriage(
        selected,
        pull.head.sha,
        pull.merge_base,
      );
      qc.setQueryData(key, state);
      setPlain(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!pull || !selected) return;
    try {
      await api.cancelTriage(selected, pull.head.sha, pull.merge_base);
      await triage.refetch();
    } catch (e) {
      setError(e);
    }
  };
  return {
    query: triage,
    /** The analysis of this revision, once there is one. */
    result,
    groups,
    busy,
    error,
    start,
    cancel,
    plain,
    setPlain,
    /** Files with unresolved line comments, which stay out of groups. */
    commentPaths,
    setCommentPaths,
  };
}
export type ReviewTriage = ReturnType<typeof useReviewTriage>;
