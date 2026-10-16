import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DeepReviewStart } from "../../../shared/deep-review";
import type { PullRef } from "../../../shared/types";
import { api } from "../../lib/api";
import { threadDraftKey, threadStorage } from "../../lib/thread-storage";
import { loadComposerSettings } from "../agents/composer-settings";
import { forgetNewThread, useDraft, writeDraft } from "../composer/drafts";
import {
  firstSetup,
  focusKey,
  reviewBranches,
  reviewTarget,
  savedSetup,
  setupKey,
  withOpus,
  type Setup,
} from "./deep-review-setup";
import {
  latestReviewSetup,
  recordReviewSetup,
  type ReviewSetupChoice,
} from "./review-setups";
import { useClaudeModels } from "../agents/useClaudeModels";

/**
 * The setup as you edit it, kept with the unsent thread and as where the
 * project's next review starts, and the focus note, kept as its text.
 */
function useSetupDraft(projectId: string, draftId: string) {
  const claudeModels = useClaudeModels().models;
  const [kept] = useState(() => threadStorage(draftId).review.load().setup);
  const [setup, setSetup] = useState<Setup>(
    () => kept ?? firstSetup(projectId),
  );
  const [touched, setTouched] = useState(
    () => !!kept || !!savedSetup(projectId) || !!latestReviewSetup(),
  );
  const draftKey = threadDraftKey(draftId);
  const focus = useDraft(draftKey);
  const setFocus = (text: string) => writeDraft(draftKey, text);
  // Notes were once kept per project.
  useEffect(() => {
    const old = localStorage.getItem(focusKey(projectId));
    if (old === null) return;
    if (!focus.trim()) writeDraft(draftKey, old);
    localStorage.removeItem(focusKey(projectId));
  }, [projectId]);
  const update = (patch: Partial<Setup>) => {
    setTouched(true);
    setSetup((s) => ({ ...s, ...patch }));
  };
  useEffect(() => {
    threadStorage(draftId).review.update({ setup });
  }, [draftId, setup]);
  useEffect(() => {
    if (touched)
      localStorage.setItem(setupKey(projectId), JSON.stringify(setup));
  }, [projectId, setup, touched]);
  // Until someone picks otherwise, Claude reviews and leads with Opus.
  useEffect(() => {
    const opus = claudeModels?.find((m) => /opus/i.test(`${m.id} ${m.name}`));
    if (touched || !opus) return;
    setSetup((s) => withOpus(s, opus.id));
  }, [claudeModels, touched]);
  return { setup, update, focus, setFocus };
}

export type TargetPick = ReturnType<typeof useTargetPick>;

/**
 * What the setup's kind of target points at: the branch and its base, the
 * pull request or the commit. Kept with the unsent thread until it starts.
 */
function useTargetPick(
  projectId: string,
  draftId: string,
  setup: Setup,
  branch: string | undefined,
  changes: number,
) {
  const [saved] = useState(() => threadStorage(draftId).review.load());
  const [pull, setPull] = useState<PullRef | null>(saved.pull ?? null);
  const [commit, setCommit] = useState(saved.commit ?? "");
  const branches = useQuery({
    queryKey: ["project-branches", projectId],
    queryFn: () => api.projectBranches(projectId),
    enabled: setup.kind === "branch",
  });
  const counts = useQuery({
    queryKey: ["project-branch-counts", projectId],
    queryFn: () => api.projectBranchCounts(projectId),
    enabled: setup.kind === "branch",
  });
  const commits = useQuery({
    queryKey: ["recent-commits", projectId],
    queryFn: async () =>
      (await api.projectHistory(projectId, "head", 40)).commits,
    enabled: setup.kind === "commit",
  });
  // Once it starts, neither branch is kept: the next review starts from the checkout into the repository's base.
  const [chosenHead, setHead] = useState(saved.head ?? "");
  const [chosenBase, setBase] = useState(saved.base ?? "");
  useEffect(() => {
    if (pull || commit || chosenHead || chosenBase)
      threadStorage(draftId).review.update({
        head: chosenHead || undefined,
        base: chosenBase || undefined,
        commit: commit || undefined,
        pull: pull ?? undefined,
      });
  }, [draftId, pull, commit, chosenHead, chosenBase]);
  const { heads, head, bases, base } = reviewBranches(
    { head: chosenHead, base: chosenBase },
    branches.data?.branches ?? [],
    branches.data?.bases ?? [],
    branch,
  );
  const chosenCommit = commit || commits.data?.[0]?.sha;
  const target = reviewTarget(setup.kind, {
    changes,
    head,
    base,
    pull,
    commit: chosenCommit,
  });
  return {
    target,
    heads,
    head,
    setHead,
    bases,
    base,
    setBase,
    branchList: branches.data,
    branchCounts: counts.data,
    branchesPending: branches.isPending,
    pull,
    setPull,
    commits: commits.data ?? [],
    commitsPending: commits.isPending,
    commit: chosenCommit,
    setCommit,
  };
}

/** A new deep review's setup, what it would review, and starting it. */
export function useDeepReviewSetup({
  projectId,
  draftId,
  branch,
  changes,
  busy,
  onStart,
}: {
  projectId: string;
  draftId: string;
  branch?: string;
  changes: number;
  busy: boolean;
  onStart: (config: DeepReviewStart) => Promise<boolean>;
}) {
  const { setup, update, focus, setFocus } = useSetupDraft(projectId, draftId);
  const pick = useTargetPick(projectId, draftId, setup, branch, changes);
  const choice: ReviewSetupChoice = {
    reviewers: setup.reviewers,
    lead: setup.lead,
    runChecks: setup.runChecks,
  };
  async function start() {
    const { target } = pick;
    if (!target || busy) return;
    // The lead works on fixes the way the composer was last set for new threads.
    const { runtimeMode } = loadComposerSettings(draftId);
    const started = await onStart({
      target,
      reviewers: setup.reviewers,
      lead: setup.lead,
      runChecks: setup.runChecks,
      focus: focus.trim(),
      runtimeMode,
    });
    if (!started) return;
    recordReviewSetup(choice, focus.trim());
    // Like a sent message, the note and what it pointed at go with this review only.
    writeDraft(threadDraftKey(draftId), "");
    forgetNewThread(draftId);
  }
  return { setup, update, focus, setFocus, pick, choice, start };
}
