// A new deep review's setup: who reviews and leads, what it covers, and how
// it's kept per project until the next review.
import { z } from "zod";
import {
  deepReviewStartSchema,
  type LeadAgent,
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
/** The first two are the default pair; Add reviewer takes the next one. */
const lineup = [
  claudeAgent("high"),
  codexAgent("gpt-5.6-sol"),
  codexAgent("gpt-5.5"),
  claudeAgent("xhigh"),
];

export interface Setup {
  kind: ReviewTarget["kind"];
  base: string;
  reviewers: ReviewAgent[];
  lead: LeadAgent;
  runChecks: boolean;
}
export const setupKey = (projectId: string) => "deep-review-setup:" + projectId;
export const focusKey = (projectId: string) => "deep-review-focus:" + projectId;
// The start schema is strict, so the saved target has to be part of it.
const setupSchema = deepReviewStartSchema
  .pick({ reviewers: true, lead: true, runChecks: true })
  .extend({
    kind: z
      .enum(["uncommitted", "branch", "pr", "commit"])
      .catch("uncommitted"),
    base: z.string().catch(""),
  });
export const savedSetup = (projectId: string): Setup | undefined =>
  setupSchema.safeParse(readJson(setupKey(projectId))).data;

/** This project's last setup, else the last review's anywhere, else a pair. */
export function firstSetup(projectId: string): Setup {
  const latest = latestReviewSetup();
  return (
    savedSetup(projectId) ?? {
      kind: "uncommitted",
      base: "",
      ...(latest ?? {
        reviewers: lineup
          .slice(0, 2)
          .map((r) => ({ ...r, prompt: lastPrompt(r.provider) })),
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

/** The reviewer Add reviewer appends. */
export function nextReviewer(reviewers: ReviewAgent[]): ReviewAgent {
  const next = lineup[reviewers.length]!;
  return { ...next, prompt: lastPrompt(next.provider) };
}

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
 * The base a branch is reviewed against: the one chosen while it's still a
 * branch, else the repository's base, local or on origin, else any other.
 * The repository's bases lead the list; the rest keep their recency order.
 */
export function reviewBase(
  chosen: string,
  branches: { name: string; current: boolean; unrelated?: boolean }[],
  repositoryBases: string[],
  branch?: string,
) {
  const others = branches
    .filter((b) => !b.current && !b.unrelated && b.name !== branch)
    .map((b) => b.name);
  const usual = repositoryBases
    .flatMap((b) => [b, `origin/${b}`])
    .filter((b) => others.includes(b));
  const bases = [...usual, ...others.filter((b) => !usual.includes(b))];
  const base = chosen && bases.includes(chosen) ? chosen : bases[0];
  return { bases, base };
}

/** What the setup would review, or nothing until it has all it needs. */
export function reviewTarget(
  kind: ReviewTarget["kind"],
  {
    changes,
    branch,
    base,
    pull,
    commit,
  }: {
    changes: number;
    branch?: string;
    base?: string;
    pull: PullRef | null;
    commit?: string;
  },
): ReviewTarget | undefined {
  switch (kind) {
    case "uncommitted":
      return changes ? { kind } : undefined;
    case "branch":
      return base && branch ? { kind, base } : undefined;
    case "pr":
      return pull ? { kind, ref: pull } : undefined;
    case "commit":
      return commit ? { kind, sha: commit } : undefined;
  }
}
