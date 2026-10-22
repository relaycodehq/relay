// Deep review: a few agents review the same changes on their own, then a
// lead agent checks what they found and fixes it with the user.
import { z } from "zod";
import { runtimeModeSchema, type RuntimeMode } from "./agent-modes";
import {
  agentName,
  agentProviderSchema,
  agents,
  reviewerProviderSchema,
} from "./agents";
import { aiSettingsSchema, type ModelChoice } from "./settings";
import { refSchema } from "./validation";

const branchNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(250)
  .refine(
    (v) => !v.startsWith("-") && !v.includes("..") && !/[\s~^:?*[\\]/.test(v),
    "Choose a valid branch.",
  );
const reviewTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("uncommitted") }).strict(),
  z
    .object({
      kind: z.literal("branch"),
      base: branchNameSchema,
      /** The branch under review; without it, the one checked out (as before it was a choice). */
      head: branchNameSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("commit"),
      sha: z.string().regex(/^[a-f0-9]{7,64}$/i, "Choose a commit."),
    })
    .strict(),
  z.object({ kind: z.literal("pr"), ref: refSchema }).strict(),
]);
export type ReviewTarget = z.infer<typeof reviewTargetSchema>;

const reviewAgentSchema = z
  .object({
    provider: reviewerProviderSchema,
    choice: aiSettingsSchema.shape.questions,
    /** What it's asked, see `reviewerPrompt`; none runs its own review. */
    prompt: z.string().trim().max(2000).optional(),
  })
  .strict();
export type ReviewAgent = z.infer<typeof reviewAgentSchema>;
/** The lead works in a thread like any other, so any agent can lead. */
const leadAgentSchema = z
  .object({
    provider: agentProviderSchema,
    choice: aiSettingsSchema.shape.questions,
  })
  .strict();
export type LeadAgent = z.infer<typeof leadAgentSchema>;

/** The agent's own review command, like `/code-review`; none for OpenCode. */
export const ownReviewCommand = (provider: ReviewAgent["provider"]) => {
  const command: string = agents[provider].reviewCommand;
  return command.startsWith("/") ? command : "";
};
/**
 * A reviewer's prompt as written in the setup: empty or the agent's own
 * review command runs that review, with anything after the command as a note
 * for it. Anything else (another command, a skill, your own words) goes to
 * the agent as written, with what to review and how to report.
 */
export function reviewerPrompt(
  provider: ReviewAgent["provider"],
  prompt = "",
): { kind: "own"; note: string } | { kind: "custom"; text: string } {
  const text = prompt.trim();
  const own = ownReviewCommand(provider);
  if (!text) return { kind: "own", note: "" };
  if (own && (text === own || text.startsWith(own + " ")))
    return { kind: "own", note: text.slice(own.length).trim() };
  return { kind: "custom", text };
}

/** A review starts with a pair; Add reviewer goes on up to this many. */
export const MAX_REVIEWERS = 30;
export const deepReviewStartSchema = z
  .object({
    target: reviewTargetSchema,
    reviewers: z.array(reviewAgentSchema).min(1).max(MAX_REVIEWERS),
    lead: leadAgentSchema,
    /** The lead may run tests and commands to confirm a finding. */
    runChecks: z.boolean(),
    focus: z.string().trim().max(4000),
    /** How the lead works on fixes afterwards, as in the composer. */
    runtimeMode: runtimeModeSchema,
  })
  .strict();
export type DeepReviewStart = z.infer<typeof deepReviewStartSchema>;

/** A review's setup before it starts: what kind of change it covers, and who reviews and leads. */
export const reviewDraftSetupSchema = deepReviewStartSchema
  .pick({ reviewers: true, lead: true, runChecks: true })
  .extend({
    kind: z
      .enum(["uncommitted", "branch", "pr", "commit"])
      .catch("uncommitted"),
  })
  // Setups saved before the base stopped being kept still carry one.
  .strip();
export type ReviewDraftSetup = z.infer<typeof reviewDraftSetupSchema>;

/** What a helper agent names a setup from, to find it again later. */
export const reviewSetupSchema = deepReviewStartSchema.pick({
  reviewers: true,
  lead: true,
  focus: true,
});
export type ReviewSetup = z.infer<typeof reviewSetupSchema>;

/** What the review covers, as resolved in the checkout when it started. */
export interface ReviewScope {
  target: ReviewTarget;
  /** "Uncommitted changes", "feature/x → main", "Commit 1a2b3c4", "PR #42". */
  label: string;
  /** A commit's subject or a PR's title. */
  title?: string;
  /** Branch checked out when the review started; null when detached. */
  branch: string | null;
  /** The reviewed changes run from `base` to `head` (commits, branches, PRs). */
  base?: string;
  head?: string;
  stats?: { files: number; additions: number; deletions: number };
  /** Where the reviewed code is checked out when the thread's checkout doesn't have it; reviewers and the lead work there. */
  checkout?: ReviewCheckout;
}
/** A worktree the review reads from and fixes in. */
export interface ReviewCheckout {
  path: string;
  /** Relay made it for this review, on the branch when it has one, and removes it after; otherwise it's the folder the branch was already checked out in. */
  made: boolean;
  /** The local branch fixes go on; the review moves to wherever it's checked out. A pull request gets one with its first fix when none holds it. */
  branch?: string;
  /** A pull request's number, and its head branch when that's in the project's own repository, which names the branch a fix makes. */
  pr?: { number: number; head?: string };
}

/** The review's topic, kept within the editable thread name's limit. */
export function reviewThreadTitle(scope: ReviewScope): string {
  const title =
    `Deep review · ${scope.label}${scope.title?.trim() ? ` · ${scope.title.trim()}` : ""}`
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .replace(/\s+/g, " ");
  return title.length > 120 ? `${title.slice(0, 119).trimEnd()}…` : title;
}

export interface DeepReviewState {
  /** The user message that asked for the review. */
  request: string;
  scope: ReviewScope;
  /** Each reviewer works in a thread of its own, listed under the review's. */
  reviewers: (ReviewAgent & { chatId: string })[];
  lead: LeadAgent;
  runChecks: boolean;
  focus?: string;
  runtimeMode: RuntimeMode;
  status: "reviewing" | "leading" | "done" | "stopped" | "failed";
  /**
   * The answer the lead's first turn ended on when it stopped or failed,
   * the latest one after a resume; resuming the lead goes on from there.
   */
  leadStopped?: string;
}
/** Picks a stopped review up in part: one reviewer again, or the lead with the reports that are in. */
export type ResumeReview = { slot: number } | { lead: true };

/** A reviewer's thread name: its place in the review and what it runs on. */
export function reviewerTitle(slot: number, reviewer: ReviewAgent) {
  const { model, reasoningEffort, fast } = reviewer.choice;
  return [
    `Reviewer ${slot + 1}`,
    agentName(reviewer.provider),
    model,
    reasoningEffort,
    fast && "Fast",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A reviewer thread's place in its review. */
export interface ReviewerTask {
  parent: string;
  slot: number;
  /** Codex's own review target, when it runs `/review`. */
  codex?: CodexReviewTarget;
}
export type CodexReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title: string | null }
  | { type: "custom"; instructions: string };

/** Claude's `/code-review` levels; Relay never asks for the paid cloud one. */
const claudeReviewLevels = ["low", "medium", "high", "xhigh", "max"];
export function claudeReviewLevel(choice: ModelChoice) {
  return claudeReviewLevels.includes(choice.reasoningEffort)
    ? choice.reasoningEffort
    : "high";
}

/**
 * Claude's `/code-review` may hand its findings to a ReportFindings tool
 * instead of writing them out. Those findings, as the answer would read.
 */
export function reportedFindings(input: unknown): string | undefined {
  const findings = (input as { findings?: unknown })?.findings;
  if (!Array.isArray(findings)) return;
  const text = (value: unknown, max: number) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";
  const lines = findings.slice(0, 50).flatMap((raw) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    const summary = text(f.summary, 400) || text(f.short_summary, 200);
    if (!summary) return [];
    const file = text(f.file, 500);
    const line =
      typeof f.line === "number" && f.line > 0 ? `:${Math.floor(f.line)}` : "";
    const why = text(f.failure_scenario, 800);
    return [
      `- ${summary}${file ? ` \`${file}${line}\`` : ""}${why ? `\n  ${why}` : ""}`,
    ];
  });
  return lines.length
    ? `Findings:\n${lines.join("\n")}`
    : "No findings survived review.";
}

/**
 * Without the tool, `/code-review` may answer with the findings' JSON alone,
 * bare or fenced. That answer written out; undefined for any other answer.
 */
export function answeredFindings(answer: string): string | undefined {
  const json = answer
    .trim()
    .replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, "$1")
    .trim();
  if (!/^[[{]/.test(json)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  const findings = Array.isArray(parsed)
    ? parsed
    : (parsed as { findings?: unknown })?.findings;
  if (
    !Array.isArray(findings) ||
    !findings.every(
      (f) =>
        f && typeof f === "object" && ("summary" in f || "short_summary" in f),
    )
  )
    return;
  return reportedFindings({ findings });
}
