// Deep review: a few agents review the same changes on their own, then a
// lead agent checks what they found and fixes it with the user.
import { z } from "zod";
import { runtimeModeSchema, type RuntimeMode } from "./agent-modes";
import { agentProviderSchema, agents, reviewerProviderSchema } from "./agents";
import { aiSettingsSchema, type ModelChoice } from "./settings";
import { filePathSchema, refSchema } from "./validation";

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
  z.object({ kind: z.literal("branch"), base: branchNameSchema }).strict(),
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

export const MAX_REVIEWERS = 4;
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
  /** "Uncommitted changes", "feature/x vs main", "Commit 1a2b3c4", "PR #42". */
  label: string;
  /** A commit's subject or a PR's title. */
  title?: string;
  /** Branch checked out when the review started; null when detached. */
  branch: string | null;
  /** The reviewed changes run from `base` to `head` (commits, branches, PRs). */
  base?: string;
  head?: string;
  stats?: { files: number; additions: number; deletions: number };
}

/** The review's topic, kept within the editable thread name's limit. */
export function reviewThreadTitle(scope: ReviewScope): string {
  const title =
    `Deep review · ${scope.label}${scope.title?.trim() ? ` · ${scope.title.trim()}` : ""}`
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .replace(/\s+/g, " ");
  return title.length > 120 ? `${title.slice(0, 119).trimEnd()}…` : title;
}

/** Codex's review scale. */
const priorities = ["P0", "P1", "P2", "P3"] as const;
export type Priority = (typeof priorities)[number];
export const priorityMeaning: Record<Priority, string> = {
  P0: "Drop everything to fix",
  P1: "Fix before this merges",
  P2: "Should be fixed",
  P3: "Nice to fix",
};

const findingFileSchema = z.object({
  path: z.string().trim().min(1).max(4096),
  line: z.number().int().positive().max(10_000_000).optional(),
});
const reviewerNumbersSchema = z
  .array(z.number().int().min(1).max(MAX_REVIEWERS))
  .max(MAX_REVIEWERS)
  .catch([]);
const findingSchema = z.object({
  id: z.string().regex(/^F\d{1,6}$/),
  priority: z.enum(priorities),
  title: z.string().trim().min(1).max(300),
  files: z.array(findingFileSchema).max(12).catch([]),
  reviewers: reviewerNumbersSchema,
  /** How the lead confirmed it. */
  check: z.string().trim().max(600).optional().catch(undefined),
});
export type Finding = z.infer<typeof findingSchema>;
const droppedFindingSchema = z.object({
  title: z.string().trim().min(1).max(300),
  reason: z.string().trim().max(600).catch(""),
  reviewers: reviewerNumbersSchema,
});
const reportSchema = z.object({
  findings: z.array(findingSchema).max(50),
  dropped: z.array(droppedFindingSchema).max(50).catch([]),
});
export type FindingsReport = z.infer<typeof reportSchema>;

export type FindingStatus = "open" | "fixing" | "fixed" | "dismissed";
export interface DeepReviewState {
  /** The user message that asked for the review. */
  request: string;
  scope: ReviewScope;
  /** Each reviewer works in a hidden thread of its own. */
  reviewers: (ReviewAgent & { chatId: string })[];
  lead: LeadAgent;
  runChecks: boolean;
  focus?: string;
  runtimeMode: RuntimeMode;
  status: "reviewing" | "leading" | "done" | "stopped" | "failed";
  /** The initial report, kept under the answer that listed it. */
  report?: FindingsReport & { messageId: string };
  /** Later batches, each shown under its own answer. */
  reports?: (FindingsReport & { messageId: string })[];
  statuses?: Record<string, FindingStatus>;
  /** Findings each fix request covers, by the user message that asked. */
  fixing?: Record<string, string[]>;
}

/** All batches in conversation order, including the initial review. */
export function reviewReports(state: DeepReviewState | undefined) {
  return [...(state?.report ? [state.report] : []), ...(state?.reports ?? [])];
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

const FENCE = "```relay-findings";
/**
 * Splits the lead's findings block off its answer. The answer stays as it
 * was when there is no block, or the block doesn't hold a valid report.
 */
export function extractFindings(body: string): {
  body: string;
  report?: FindingsReport;
} {
  const start = body.lastIndexOf(FENCE);
  if (start < 0) return { body };
  const open = body.indexOf("\n", start);
  if (open < 0) return { body };
  // The closing fence starts a line; a JSON string can't hold a line break.
  const close = body.indexOf("\n```", open);
  const json = body.slice(open + 1, close < 0 ? undefined : close).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { body };
  }
  // A bare list of findings is a report too.
  const report = reportSchema.safeParse(
    Array.isArray(parsed) ? { findings: parsed } : parsed,
  );
  if (!report.success) return { body };
  const seen = new Set<string>();
  const findings = report.data.findings.filter(
    (f) => !seen.has(f.id) && seen.add(f.id),
  );
  return {
    body: [body.slice(0, start), close < 0 ? "" : body.slice(close + 4)]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n"),
    report: { findings, dropped: report.data.dropped },
  };
}

/** Paths the lead gave, relative to the checkout; others are dropped. */
export function checkoutPaths(report: FindingsReport, root: string) {
  const prefix = root.replace(/\/+$/, "") + "/";
  const relative = (path: string) => {
    let value = path.replace(/^\.\//, "");
    if (value.startsWith(prefix)) value = value.slice(prefix.length);
    return filePathSchema.safeParse(value).success ? value : null;
  };
  return {
    ...report,
    findings: report.findings.map((f) => ({
      ...f,
      files: f.files.flatMap((file) => {
        const path = relative(file.path);
        return path ? [{ ...file, path }] : [];
      }),
    })),
  };
}

/** The message asking the lead to fix `findings`, with the user's note. */
export function fixRequest(
  provider: LeadAgent["provider"],
  findings: Finding[],
  note = "",
) {
  const list = findings
    .map((f) => `- \`${f.id}\` ${f.title} (${f.priority})`)
    .join("\n");
  return `@${provider} Fix ${findings.length === 1 ? "this finding" : "these findings"} from the review:\n${list}${note.trim() ? `\n\n${note.trim()}` : ""}`;
}

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
