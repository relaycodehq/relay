import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notedPaths, type ChangeGroup } from "../../shared/triage";
import { revisionOf } from "../../shared/types";
import { api } from "./api";
import { setGroupViewed } from "./review-progress";
import { useProjectChecks } from "./useProjectChecks";
import { PULL_BOARD } from "./usePullBoard";
import type { PullSelection } from "./usePullSelection";
import { useResumeReview } from "./useResumeReview";
import { useReviewFiles } from "./useReviewFiles";
import { useReviewProgress } from "./useReviewProgress";
import { useReviewTriage } from "./useReviewTriage";
import { useViewedCarryOver } from "./useViewedCarryOver";

/**
 * Reviewing the selected PR, on the Pull requests page or in a PR thread's
 * pane: the PR, its files in review order, what's viewed, and its checks.
 */
export function usePullReview(
  selection: PullSelection,
  userId: number,
  onError: (e: unknown) => void,
) {
  const { selected, restoring, file, navigation } = selection;
  const qc = useQueryClient();
  const pull = useQuery({
    queryKey: ["pull", selected],
    queryFn: () => api.pull(selected!),
    enabled: !!selected,
  });
  const checks = useProjectChecks(pull.data);
  const resume = useResumeReview(selection, pull.data, userId);
  const progress = useReviewProgress(selected, onError);
  const changedSinceViewed = useViewedCarryOver(selected, pull.data, progress);
  const revision = pull.data ? revisionOf(pull.data) : "";
  const triage = useReviewTriage(
    selected,
    pull.data,
    revision,
    restoring,
    progress.progress,
  );
  const files = useReviewFiles(selection, pull.data, triage, onError);
  /** Marks a group viewed or not, then with `viewed` moves past the open file if it's in it. */
  const reviewGroup = async (group: ChangeGroup, viewed: boolean) => {
    if (!selected || !pull.data || !progress.initial.isSuccess)
      throw new Error("Review data is still loading.");
    const nav = navigation.current;
    const paths = await api.groupPaths(
      selected,
      pull.data.head.sha,
      pull.data.merge_base,
      group.id,
    );
    if (nav !== navigation.current)
      throw new Error("The selected review changed. Open the group again.");
    const next = progress.update((p) =>
      setGroupViewed(
        p,
        paths,
        group.paths,
        viewed,
        revision,
        new Set([...notedPaths(p, revision), ...triage.commentPaths]),
      ),
    );
    if (viewed && file && paths.includes(file))
      await files.advanceUnread(file, next, false);
  };
  const refresh = async () => {
    navigation.current++;
    await Promise.all([
      qc.invalidateQueries({ queryKey: [PULL_BOARD] }),
      qc.invalidateQueries({ queryKey: ["pull"] }),
      qc.invalidateQueries({ queryKey: ["files"] }),
      qc.invalidateQueries({ queryKey: ["reviews"] }),
      qc.invalidateQueries({ queryKey: ["reviewComments"] }),
      qc.invalidateQueries({ queryKey: ["discussion"] }),
    ]);
  };
  return {
    pull,
    checks,
    /** Whether the PR reopened at launch is still yours to review. */
    resume,
    progress,
    changedSinceViewed,
    revision,
    triage,
    files,
    reviewGroup,
    refresh,
    /** The open file, once the list has it. */
    current: files.all.find((f) => f.filename === file),
    readCount: files.all.filter(
      (f) => progress.progress.read[f.filename] === revision,
    ).length,
  };
}
export type PullReview = ReturnType<typeof usePullReview>;
