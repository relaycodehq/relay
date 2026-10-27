import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MAX_REVIEWERS,
  passCount,
  type DeepReviewStart,
} from "../../../shared/deep-review";
import type { PullRef, Repo } from "../../../shared/types";
import type { CommitSummary } from "../../../shared/history";
import { api } from "../../lib/api";
import { threadStorage } from "../../lib/thread-storage";
import { loadComposerSettings } from "../agents/composer-settings";
import {
  clearDraftScope,
  forgetNewThread,
  hasDraft,
  updateReviewDraft,
  useDraftRecord,
} from "../composer/drafts";
import {
  baseKey,
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
import { usePoll } from "../../lib/poll";
import { readText, writeJson, writeText } from "../../lib/persisted-store";
import { useReviewPasses } from "./passes/useReviewPasses";

/**
 * Keeps `change` with the unsent review, and the setup it was made with the
 * first time, so another review changing the project's setup can't swap it.
 * Cleared down to a setup any new review would start with, it's no draft.
 */
export function keepReview(
  projectId: string,
  draftId: string,
  setup: Setup,
  change: Parameters<typeof updateReviewDraft>[1],
) {
  const review = { ...threadStorage(draftId).review.load(), ...change };
  const more = Object.entries(review).some(
    ([part, value]) => part !== "setup" && part !== "at" && !!value,
  );
  const kept =
    !!review.setup &&
    JSON.stringify(review.setup) !== JSON.stringify(firstSetup(projectId));
  updateReviewDraft(draftId, {
    ...change,
    setup: more ? (review.setup ?? setup) : kept ? review.setup : undefined,
  });
}

/**
 * The setup as you edit it and its focus note, kept with the unsent thread
 * once you change either; an edited setup is also where the project's next
 * review starts.
 */
function useSetupDraft(projectId: string, draftId: string) {
  const claudeModels = useClaudeModels().models;
  const [setup, setSetup] = useState<Setup>(
    () => threadStorage(draftId).review.load().setup ?? firstSetup(projectId),
  );
  // An untouched setup is only a default: not kept, and still free to take Opus.
  const [edited, setEdited] = useState(false);
  const [touched] = useState(
    () => !!savedSetup(projectId) || !!latestReviewSetup(),
  );
  const focus = useDraftRecord(draftId, (d) => d.review?.focus ?? "");
  const setFocus = (text: string) =>
    keepReview(projectId, draftId, setup, { focus: text || undefined });
  // Notes were once kept per project; the first review with none takes it.
  useEffect(() => {
    const old = readText(focusKey(projectId));
    if (old === null || threadStorage(draftId).review.load().focus) return;
    updateReviewDraft(draftId, { focus: old || undefined });
    writeText(focusKey(projectId), null);
  }, [projectId, draftId]);
  const update = (patch: Partial<Setup>) => {
    setEdited(true);
    setSetup((s) => ({ ...s, ...patch }));
  };
  useEffect(() => {
    if (!edited) return;
    updateReviewDraft(draftId, { setup });
    writeJson(setupKey(projectId), setup);
  }, [projectId, draftId, setup, edited]);
  // Until someone picks otherwise, Claude reviews and leads with Opus.
  useEffect(() => {
    const opus = claudeModels?.find((m) => /opus/i.test(`${m.id} ${m.name}`));
    if (touched || edited || !opus) return;
    setSetup((s) => withOpus(s, opus.id));
  }, [claudeModels, touched, edited]);
  return { setup, update, focus, setFocus };
}

export type TargetPick = ReturnType<typeof useTargetPick>;

const sameRepo = (a: Repo, b: Repo | null | undefined) =>
  !!b &&
  a.owner === b.owner &&
  a.name === b.name &&
  (!a.server || !b.server || a.server === b.server);

/**
 * What the setup's kind of target points at: the branch and its base, the
 * pull request or the commit. What you pick is kept with the unsent thread
 * until it starts; what you leave follows the checkout.
 */
function useTargetPick(
  projectId: string,
  draftId: string,
  setup: Setup,
  repository: Repo | null | undefined,
  branch: string | undefined,
  changes: number,
  /** The latest commits where the review was picked to read, when that's another folder. */
  elsewhere?: { commits?: CommitSummary[] },
) {
  const poll = usePoll();
  const [saved] = useState(() => threadStorage(draftId).review.load());
  // A pull request kept from a repository the project no longer points at is gone.
  const [pull, setPull] = useState<PullRef | null>(() =>
    saved.pull && sameRepo(saved.pull, repository) ? saved.pull : null,
  );
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
  // Once it starts, the branch isn't kept, but the base is: the project's next review goes into the same one.
  const [chosenHead, setHead] = useState(saved.head ?? "");
  const [chosenBase, setBase] = useState(
    () => saved.base ?? readText(baseKey(projectId)) ?? "",
  );
  const keep = (change: Parameters<typeof updateReviewDraft>[1]) =>
    keepReview(projectId, draftId, setup, change);
  const commit = useCommitPick(projectId, setup, saved.commit, keep, elsewhere);
  const { heads, head, bases, base } = reviewBranches(
    { head: chosenHead, base: chosenBase },
    branches.data?.branches ?? [],
    branches.data?.bases ?? [],
    branch,
  );
  const baseChanges = useQuery({
    queryKey: ["project-branch-changes", projectId, base],
    queryFn: () => api.projectBranchChanges(projectId, base!),
    enabled: setup.kind === "branch" && !!base,
    refetchInterval: poll(3000),
  });
  const target = reviewTarget(setup.kind, {
    changes,
    head,
    base,
    pull,
    commit: commit.commit,
  });
  return {
    target,
    heads,
    head,
    setHead: (name: string) => {
      setHead(name);
      keep({ head: name || undefined });
    },
    bases,
    base,
    setBase: (name: string) => {
      setBase(name);
      keep({ base: name || undefined });
      if (name) writeText(baseKey(projectId), name);
    },
    baseChanges: baseChanges.isError ? undefined : baseChanges.data,
    branchList: branches.data,
    branchCounts: counts.data,
    branchesPending: branches.isPending,
    pull,
    setPull: (ref: PullRef | null) => {
      setPull(ref);
      keep({ pull: ref ?? undefined });
    },
    ...commit,
  };
}

/** The commit a commit review points at: the one picked, while it's among the latest, else the newest. */
function useCommitPick(
  projectId: string,
  setup: Setup,
  saved: string | undefined,
  keep: (change: Parameters<typeof updateReviewDraft>[1]) => void,
  elsewhere?: { commits?: CommitSummary[] },
) {
  const [picked, setPicked] = useState(saved ?? "");
  const commits = useQuery({
    queryKey: ["recent-commits", projectId],
    queryFn: async () =>
      (await api.projectHistory(projectId, "head", 40)).commits,
    enabled: setup.kind === "commit" && !elsewhere,
  });
  const recent = elsewhere ? elsewhere.commits : commits.data;
  const commit = recent?.some((c) => c.sha === picked)
    ? picked
    : recent?.[0]?.sha;
  return {
    commits: recent ?? [],
    commitsPending: !recent,
    commit,
    setCommit: (sha: string) => {
      setPicked(sha);
      keep({ commit: sha || undefined });
    },
  };
}

/** A new deep review's setup, what it would review, and starting it. */
export function useDeepReviewSetup({
  projectId,
  draftId,
  repository,
  branch,
  changes,
  on,
  busy,
  onStart,
}: {
  projectId: string;
  draftId: string;
  repository?: Repo | null;
  branch?: string;
  changes: number;
  /** A branch checked out in another folder, which the review reads in instead. */
  on?: string;
  busy: boolean;
  onStart: (config: DeepReviewStart) => Promise<boolean>;
}) {
  const { setup, update, focus, setFocus } = useSetupDraft(projectId, draftId);
  const here = useReviewFolder(projectId, on, { branch, changes });
  const pick = useTargetPick(
    projectId,
    draftId,
    setup,
    repository,
    here.branch,
    here.changes,
    here.elsewhere,
  );
  const passes = useReviewPasses(projectId, pick.target, here.changes, on);
  const runs = setup.reviewers.length * passCount(passes);
  const choice: ReviewSetupChoice = {
    reviewers: setup.reviewers,
    lead: setup.lead,
    runChecks: setup.runChecks,
  };
  async function start() {
    const { target } = pick;
    if (!target || busy || runs > MAX_REVIEWERS) return;
    // The lead works on fixes the way the composer was last set for new threads.
    const { runtimeMode } = loadComposerSettings(draftId);
    const started = await onStart({
      target,
      reviewers: setup.reviewers,
      lead: setup.lead,
      runChecks: setup.runChecks,
      focus: focus.trim(),
      runtimeMode,
      ...(on ? { on } : {}),
      ...(passes.passes.length && {
        passes: passes.passes,
        seams: passes.seams,
      }),
    });
    if (!started) return;
    recordReviewSetup(choice, focus.trim());
    // The setup, its note and what it pointed at go with this review; a
    // message written before it was one stays a draft of its own.
    clearDraftScope(draftId);
    if (!hasDraft(draftId)) forgetNewThread(draftId);
  }
  return {
    setup,
    update,
    focus,
    setFocus,
    /** The branch and uncommitted files the review would read. */
    here,
    pick,
    passes,
    /** Reviewer runs, once a pass each: past MAX_REVIEWERS it can't start. */
    runs,
    choice,
    start,
  };
}

/**
 * What a new review reads: the project folder's branch and uncommitted
 * files, or with `on`, those of the folder that branch is checked out in,
 * and its latest commits.
 */
function useReviewFolder(
  projectId: string,
  on: string | undefined,
  projectFolder: { branch?: string; changes: number },
) {
  const poll = usePoll();
  const folder = useQuery({
    queryKey: ["deep-review-folder", projectId, on],
    queryFn: () => api.deepReviewFolder(projectId, on!),
    enabled: !!on,
    refetchInterval: poll(3000),
  });
  if (!on) return { ...projectFolder, elsewhere: undefined };
  return {
    branch: on,
    changes: folder.data?.changes ?? 0,
    elsewhere: { commits: folder.data?.commits },
  };
}
