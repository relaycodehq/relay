import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DeepReviewStart } from "../../../shared/deep-review";
import type { PullRef } from "../../../shared/types";
import { api } from "../../lib/api";
import { loadComposerSettings } from "../agents/composer-settings";
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

/** The setup and focus note as you edit them, kept for the project's next review. */
function useSetupDraft(projectId: string) {
  const claudeModels = useClaudeModels().models;
  const [setup, setSetup] = useState<Setup>(() => firstSetup(projectId));
  const [touched, setTouched] = useState(
    () => !!savedSetup(projectId) || !!latestReviewSetup(),
  );
  const [focus, setFocus] = useState(
    () => localStorage.getItem(focusKey(projectId)) ?? "",
  );
  const update = (patch: Partial<Setup>) => {
    setTouched(true);
    setSetup((s) => ({ ...s, ...patch }));
  };
  useEffect(() => {
    if (touched)
      localStorage.setItem(setupKey(projectId), JSON.stringify(setup));
  }, [projectId, setup, touched]);
  useEffect(() => {
    localStorage.setItem(focusKey(projectId), focus);
  }, [projectId, focus]);
  // Until someone picks otherwise, Claude reviews and leads with Opus.
  useEffect(() => {
    const opus = claudeModels?.find((m) => /opus/i.test(`${m.id} ${m.name}`));
    if (touched || !opus) return;
    setSetup((s) => withOpus(s, opus.id));
  }, [claudeModels, touched]);
  return { setup, update, focus, setFocus };
}

export type TargetPick = ReturnType<typeof useTargetPick>;

/** What the setup's kind of target points at: the branch and its base, the pull request or the commit. */
function useTargetPick(
  projectId: string,
  setup: Setup,
  branch: string | undefined,
  changes: number,
) {
  const [pull, setPull] = useState<PullRef | null>(null);
  const [commit, setCommit] = useState("");
  const branches = useQuery({
    queryKey: ["project-branches", projectId],
    queryFn: () => api.projectBranches(projectId),
    enabled: setup.kind === "branch",
  });
  const commits = useQuery({
    queryKey: ["recent-commits", projectId],
    queryFn: async () =>
      (await api.projectHistory(projectId, "head", 40)).commits,
    enabled: setup.kind === "commit",
  });
  // Unlike the base, the reviewed branch isn't kept: the next review starts on the checkout's.
  const [chosenHead, setHead] = useState("");
  const { heads, head, bases, base } = reviewBranches(
    { head: chosenHead, base: setup.base },
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
  settingsKey,
  branch,
  changes,
  busy,
  onStart,
}: {
  projectId: string;
  settingsKey: string;
  branch?: string;
  changes: number;
  busy: boolean;
  onStart: (config: DeepReviewStart) => Promise<boolean>;
}) {
  const { setup, update, focus, setFocus } = useSetupDraft(projectId);
  const pick = useTargetPick(projectId, setup, branch, changes);
  const choice: ReviewSetupChoice = {
    reviewers: setup.reviewers,
    lead: setup.lead,
    runChecks: setup.runChecks,
  };
  async function start() {
    const { target } = pick;
    if (!target || busy) return;
    // The lead works on fixes the way the composer was last set for new threads.
    const { runtimeMode } = loadComposerSettings(settingsKey);
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
    // Like a sent message, the note goes with this review only.
    localStorage.removeItem(focusKey(projectId));
  }
  return { setup, update, focus, setFocus, pick, choice, start };
}
