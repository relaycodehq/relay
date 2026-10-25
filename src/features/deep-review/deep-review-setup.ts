// A new deep review's setup: who reviews and leads and what it covers. Each
// unsent review keeps its own; the project's last one is where the next starts.
import {
  reviewDraftSetupSchema,
  type LeadAgent,
  type ReviewDraftSetup,
  type ReviewAgent,
  type ReviewTarget,
} from "../../../shared/deep-review";
import type { PullRef } from "../../../shared/types";
import { readJson } from "../../lib/persisted-store";
import { lastPrompt, latestReviewSetup } from "./review-setups";

const claudeAgent = (reasoningEffort: "high" | "xhigh"): ReviewAgent => ({
  provider: "claude",
  // The Opus model fills in once Claude lists its models.
  choice: { model: "", reasoningEffort, fast: false },
});

const codexAgent = (model: string): ReviewAgent => ({
  provider: "codex",
  choice: { model, reasoningEffort: "high", fast: false },
});

const defaultPair = [claudeAgent("high"), codexAgent("gpt-5.6-sol")];

export type Setup = ReviewDraftSetup;
export const setupKey = (projectId: string) => "deep-review-setup:" + projectId;
export const focusKey = (projectId: string) => "deep-review-focus:" + projectId;
export const baseKey = (projectId: string) => "deep-review-base:" + projectId;
export const savedSetup = (projectId: string): Setup | undefined =>
  reviewDraftSetupSchema.safeParse(readJson(setupKey(projectId))).data;

/** This project's last setup, else the last review's anywhere, else a pair. */
export function firstSetup(projectId: string): Setup {
  const latest = latestReviewSetup();
  return (
    savedSetup(projectId) ?? {
      kind: "uncommitted",
      ...(latest ?? {
        reviewers: defaultPair.map((r) => ({ ...r, prompt: lastPrompt(r.provider) })),
        lead: claudeAgent("high"),
        runChecks: true,
      }),
    }
  );
}

/** Claude agents still on its default model review and lead with `opus`. */
export function withOpus(setup: Setup, opus: string): Setup {
  const fill = <A extends ReviewAgent | LeadAgent>(a: A): A =>
    a.provider === "claude" && !a.choice.model
      ? { ...a, choice: { ...a.choice, model: opus } }
      : a;
  return {
    ...setup,
    reviewers: setup.reviewers.map(fill),
    lead: fill(setup.lead),
  };
}

/**
 * Add reviewer repeats the last one: more runs of a model find more, and a
 * model picked in the setup can't go stale the way a hardcoded one did.
 */
export const nextReviewer = (reviewers: ReviewAgent[]): ReviewAgent => ({
  ...reviewers.at(-1)!,
});

/** Reviewer `i` on another model; prompts belong to an agent, so another starts where you left it. */
export const swapReviewer = (
  reviewers: ReviewAgent[],
  i: number,
  choice: ReviewAgent["choice"],
  provider: ReviewAgent["provider"],
): ReviewAgent[] =>
  reviewers.map((r, j) =>
    j !== i
      ? r
      : {
          provider,
          choice,
          prompt: provider === r.provider ? r.prompt : lastPrompt(provider),
        },
  );

/**
 * The branch a branch review covers and the base it goes into. The branch is
 * the one chosen, else the one checked out unless that is one of the
 * repository's bases, then the newest other; a detached checkout has none
 * until one is chosen. The base is the one chosen while it's still a branch
 * other than that, else the repository's base, local or on origin, else any
 * other. The repository's bases lead the list; the rest keep their order.
 */
export function reviewBranches(
  chosen: { head: string; base: string },
  branches: { name: string; unrelated?: boolean }[],
  repositoryBases: string[],
  checkedOut?: string,
) {
  const heads = branches.filter((b) => !b.unrelated).map((b) => b.name);
  const isBase = (b: string) =>
    repositoryBases.some((r) => b === r || b === `origin/${r}`);
  const onBase =
    checkedOut && isBase(checkedOut)
      ? heads.find((b) => !isBase(b))
      : undefined;
  const head = [chosen.head, onBase, checkedOut].find(
    (b) => b && heads.includes(b),
  );
  const others = heads.filter((b) => b !== head);
  const usual = repositoryBases
    .flatMap((b) => [b, `origin/${b}`])
    .filter((b) => others.includes(b));
  const bases = [...usual, ...others.filter((b) => !usual.includes(b))];
  const base =
    chosen.base && bases.includes(chosen.base) ? chosen.base : bases[0];
  return { heads, head, bases, base };
}

/** What the setup would review, or nothing until it has all it needs. */
export function reviewTarget(
  kind: ReviewTarget["kind"],
  {
    changes,
    head,
    base,
    pull,
    commit,
  }: {
    changes: number;
    head?: string;
    base?: string;
    pull: PullRef | null;
    commit?: string;
  },
): ReviewTarget | undefined {
  switch (kind) {
    case "uncommitted":
      return changes ? { kind } : undefined;
    case "branch":
      return base && head && base !== head ? { kind, head, base } : undefined;
    case "pr":
      return pull ? { kind, ref: pull } : undefined;
    case "commit":
      return commit ? { kind, sha: commit } : undefined;
  }
}
