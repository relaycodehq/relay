// Deep review: a few agents review the same changes on their own, then a
// lead agent checks what they found and fixes it with the user.
import { z } from "zod";
import { runtimeModeSchema, type RuntimeMode } from "./agent-modes";
import {
  type AgentProvider,
  agentName,
  agentProviderSchema,
  agents,
  reviewerProviderSchema,
} from "./agents";
import type { DiffKind } from "./diff-kinds";
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
export const reviewTargetSchema = z.discriminatedUnion("kind", [
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

/** A review starts with a pair; Add reviewer goes on up to this many, its passes counted. */
export const MAX_REVIEWERS = 30;
const reviewPassSchema = z
  .array(z.string().trim().min(1).max(500))
  .min(1)
  .max(200);
const deepReviewConfigSchema = z
  .object({
    target: reviewTargetSchema,
    reviewers: z.array(reviewAgentSchema).min(1).max(MAX_REVIEWERS),
    lead: leadAgentSchema,
    /** The lead may run tests and commands to confirm a finding. */
    runChecks: z.boolean(),
    focus: z.string().trim().max(4000),
    /** How the lead works on fixes afterwards, as in the composer. */
    runtimeMode: runtimeModeSchema,
    /** The parts every reviewer reviews one after another; a review in one pass has none. */
    passes: z.array(reviewPassSchema).max(MAX_REVIEWERS).optional(),
    /** After the passes, one more over the whole change for how the parts fit together. */
    seams: z.boolean().optional(),
    /** A branch checked out in another folder, which a review of its own reads and fixes in instead of the thread's. */
    on: z.string().min(1).max(250).optional(),
  })
  .strict();

/** How many times each reviewer reviews: once a pass, the seams counted. */
export const passCount = (c: { passes?: unknown[]; seams?: boolean }) =>
  c.passes?.length ? c.passes.length + (c.seams ? 1 : 0) : 1;

export const deepReviewStartSchema = deepReviewConfigSchema.refine(
  (c) => c.reviewers.length * passCount(c) <= MAX_REVIEWERS,
  `Each pass runs every reviewer, and ${MAX_REVIEWERS} reviewers are the most a review runs. Take out a pass or a reviewer.`,
);

export type DeepReviewStart = z.infer<typeof deepReviewStartSchema>;

/** A review's setup before it starts: what kind of change it covers, and who reviews and leads. */
export const reviewDraftSetupSchema = deepReviewConfigSchema
  .pick({ reviewers: true, lead: true, runChecks: true })
  .extend({
    kind: z
      .enum(["uncommitted", "branch", "pr", "commit"])
      .catch("uncommitted"),
  })
  // Setups saved before the base stopped being kept still carry one.
  .strip();
export type ReviewDraftSetup = z.infer<typeof reviewDraftSetupSchema>;

/** The longest name a review setup goes by, saved or as the deep_review tool lists it. */
export const REVIEW_SETUP_NAME_MAX = 80;

/** A setup you've run, as the deep review sheet lists it; the main process keeps a copy for the deep_review tool. */
export const savedReviewSetupSchema = z.object({
  id: z.string().max(100),
  /** When it last ran. */
  at: z.number(),
  name: z.string().max(REVIEW_SETUP_NAME_MAX).optional(),
  pinned: z.boolean().optional(),
  setup: deepReviewConfigSchema.pick({
    reviewers: true,
    lead: true,
    runChecks: true,
  }),
});

export type SavedReviewSetup = z.infer<typeof savedReviewSetupSchema>;

/** What a helper agent names a setup from, to find it again later. */
export const reviewSetupSchema = deepReviewConfigSchema.pick({
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
  /** A branch review's two branches, named without the remote they come from. */
  branches?: { head: string; base: string };
  stats?: {
    files: number;
    additions: number;
    deletions: number;
    /** The lines split into code, tests, fixtures, docs and generated files; missing on older reviews. */
    byKind?: Record<DiffKind, { additions: number; deletions: number }>;
  };
  /** Where the reviewed code is checked out when the thread's checkout doesn't have it; reviewers and the lead work there. */
  checkout?: ReviewCheckout;
  /**
   * The folder the thread worked in when a round that made no checkout
   * started; its reviewers work there too. What isn't on disk there, they
   * read from Git.
   */
  folder?: string;
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

/** A thread name made of `text`, on one line and within the editable name's limit. */
function threadName(text: string) {
  const name = text.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ");
  return name.length > 120 ? `${name.slice(0, 119).trimEnd()}…` : name;
}

/**
 * What the review is about, in words: the branch, or the commit's or pull
 * request's subject. Its card shows the refs (`share → dev`, `PR #42`)
 * beside it, so the name doesn't repeat them; uncommitted changes have no
 * name of their own.
 */
function reviewTopic({ target, branches, branch, title, label }: ReviewScope) {
  switch (target.kind) {
    case "uncommitted":
      return undefined;
    case "branch":
      return branches?.head ?? target.head ?? branch ?? undefined;
    case "commit":
    case "pr":
      return title?.trim() || label;
  }
}

export function reviewThreadTitle(scope: ReviewScope): string {
  const topic = reviewTopic(scope);
  return threadName(topic ? `Deep review · ${topic}` : "Deep review");
}

/** What reviews were named before: their label, later followed by the subject. */
export function earlierReviewTitles(scope: ReviewScope) {
  const subject = scope.title?.trim();
  return [
    threadName(`Deep review · ${scope.label}`),
    threadName(`Deep review · ${scope.label}${subject ? ` · ${subject}` : ""}`),
  ];
}

/**
 * One round of a deep review. A thread can hold several, one after another;
 * the user message that asked for a round names it.
 */
export interface DeepReviewState {
  /** The user message that asked for the review, and the round's key. */
  request: string;
  scope: ReviewScope;
  /** Each reviewer works in a thread of its own, listed under the review's; a split review has each reviewer once a pass. */
  reviewers: (ReviewAgent & { chatId: string; pass?: number })[];
  /** The parts reviewed one after another, when the review is split. */
  passes?: ReviewPassState[];
  /** The pass whose reviewers work, or worked last. */
  pass?: number;
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
  /**
   * The lead's first answer to the round, named before it starts. Rounds
   * saved before this was kept have the first answer after their request.
   */
  leadAnswer?: string;
}

/** A pass as its review runs it. */
export interface ReviewPassState {
  /** As written in the setup. */
  paths: string[];
  /** What its reviewers are asked to diff: its paths, less what other passes and fixtures took. */
  specs: string[];
  /** Lines its reviewers read, lockfiles and fixtures left out. */
  lines: number;
  /** The last pass, over the whole change: how the other passes' parts fit together. */
  seams?: boolean;
}

/** The reviewers' slots of pass `pass`, or of the whole review when it isn't split. */
export const passSlots = (state: DeepReviewState, pass: number) =>
  [...state.reviewers.keys()].filter(
    (slot) => (state.reviewers[slot]!.pass ?? 0) === pass,
  );

/** A reviewer whose pass has started: those of later passes haven't been asked yet. */
export const passStarted = (
  state: DeepReviewState,
  reviewer: { pass?: number },
) => (reviewer.pass ?? 0) <= (state.pass ?? 0);

/** A split review's reviewers have a pass after this one to start. */
export const hasNextPass = (state: DeepReviewState) =>
  (state.pass ?? 0) < (state.passes?.length ?? 1) - 1;

/** The thread's latest round: the one Stop, Resume and following its branch act on. */
export const latestReview = <R>(chat: { reviews?: R[] }) =>
  chat.reviews?.at(-1);

/** A deep review as its sidebar card shows it. */
export interface ReviewCard {
  /** "Uncommitted changes", "Commit 1a2b3c4", "PR #42"; a branch review shows `branches`. */
  label: string;
  branches?: { head: string; base: string };
  lead: AgentProvider;
  reviewers: number;
}

export function reviewCard({
  scope,
  lead,
  reviewers,
}: DeepReviewState): ReviewCard {
  const { target } = scope;
  // Reviews from before `branches` was kept show their branches as named.
  const head = target.kind === "branch" ? (target.head ?? scope.branch) : null;
  const branches =
    scope.branches ??
    (target.kind === "branch" && head
      ? { head, base: target.base }
      : undefined);
  return {
    label: scope.label,
    ...(branches ? { branches } : {}),
    lead: lead.provider,
    // A split review lists each reviewer once a pass.
    reviewers: reviewers.filter((r) => !r.pass).length,
  };
}

/**
 * The round a deep review's own thread works in: the latest that checked the
 * reviewed code out. A round that made no checkout reviewed where the thread
 * already worked, so it doesn't move it.
 */
export const workingReview = <
  R extends { scope: { checkout?: unknown } },
>(chat: {
  reviews?: R[];
}) => chat.reviews?.filter((r) => r.scope.checkout).at(-1);

/**
 * The round each main-conversation message falls in, by its id: the latest
 * one asked for up to it.
 */
export function messageRounds(
  messages: readonly { id: string; parentId?: string | null; side?: unknown }[],
  reviews: DeepReviewState[] | undefined,
) {
  const byRequest = new Map(reviews?.map((r) => [r.request, r]));
  const rounds = new Map<string, DeepReviewState>();
  let current: DeepReviewState | undefined;
  for (const m of messages) {
    if (m.parentId || m.side) continue;
    current = byRequest.get(m.id) ?? current;
    if (current) rounds.set(m.id, current);
  }
  return rounds;
}

/** The round `request` asked for; rounds from before rounds had keys are the first. */
export const roundOf = (
  reviews: DeepReviewState[] | undefined,
  request: string | undefined,
) => (request ? reviews?.find((r) => r.request === request) : reviews?.[0]);

/** The round a reviewer works for. */
export const reviewerRound = (
  reviews: DeepReviewState[] | undefined,
  task: ReviewerTask,
) => roundOf(reviews, task.round);

/** Reviewers or the lead's first turn are at work: a new round waits for them. */
export const reviewRunning = (state: DeepReviewState | undefined) =>
  state?.status === "reviewing" || state?.status === "leading";

/** Picks a stopped review up in part: one reviewer again, or the lead with the reports that are in. */
export type ResumeReview = { slot: number } | { lead: true };

/** A reviewer's thread name: its place in the review and what it runs on. */
export function reviewerTitle(
  slot: number,
  reviewer: ReviewAgent & { pass?: number },
) {
  const { model, reasoningEffort, fast } = reviewer.choice;
  return [
    `Reviewer ${slot + 1}`,
    reviewer.pass !== undefined && `pass ${reviewer.pass + 1}`,
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
  /** Its round's `request`; reviewers from before rounds belong to the first. */
  round?: string;
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
