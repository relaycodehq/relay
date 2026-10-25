// Findings: problems an agent lists in a fenced relay-findings block that
// ends its answer. Any thread can publish them; a deep review's lead is asked to.
import { z } from "zod";
import type { AgentProvider } from "./agents";
import { MAX_REVIEWERS } from "./deep-review";
import { filePathSchema } from "./validation";

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

/** A batch of findings, shown under the answer that listed it. */
export type PublishedReport = FindingsReport & { messageId: string };

/** What a thread's answers reported, and where each finding stands. */
export interface ThreadFindings {
  /** In conversation order. */
  reports: PublishedReport[];
  statuses?: Record<string, FindingStatus>;
  /** Findings each fix request covers, by the user message that asked. */
  fixing?: Record<string, string[]>;
}

export function threadReports(findings: ThreadFindings | undefined) {
  return findings?.reports ?? [];
}

/** The number the thread's next finding gets, after every one it published. */
export function nextFindingNumber(findings: ThreadFindings | undefined) {
  const ids = threadReports(findings).flatMap((r) =>
    r.findings.map((f) => Number(f.id.slice(1))),
  );
  return Math.max(0, ...ids) + 1;
}

const FENCE = "```relay-findings";

/**
 * Splits a findings block off the end of an answer. Only a block that starts
 * its own line, is closed, and has nothing after it counts: one quoted
 * mid-answer stays where it is, as does one that doesn't hold a valid report.
 */
export function extractFindings(body: string): {
  body: string;
  report?: FindingsReport;
} {
  const text = body.trimEnd();
  if (!text.endsWith("\n```")) return { body };
  const start = text.lastIndexOf(FENCE);
  if (start < 0 || (start > 0 && text[start - 1] !== "\n")) return { body };
  const open = text.indexOf("\n", start);
  if (text.slice(start + FENCE.length, open).trim()) return { body };
  const json = text.slice(open + 1, -4);
  // Another fence inside means the block isn't the one that ends the answer.
  if (json.includes("\n```")) return { body };
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
    body: text.slice(0, start).trim(),
    report: { findings, dropped: report.data.dropped },
  };
}

/** Paths the agent gave, relative to the checkout; others are dropped. */
export function checkoutPaths(report: FindingsReport, root?: string) {
  const prefix = root && root.replace(/\/+$/, "") + "/";
  const relative = (path: string) => {
    let value = path.replace(/^\.\//, "");
    if (prefix && value.startsWith(prefix)) value = value.slice(prefix.length);
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

/** The message asking `provider` to fix `findings`, with the user's note. */
export function fixRequest(
  provider: AgentProvider,
  findings: Finding[],
  note = "",
) {
  const list = findings
    .map((f) => `- \`${f.id}\` ${f.title} (${f.priority})`)
    .join("\n");
  return `@${provider} Fix ${findings.length === 1 ? "this finding" : "these findings"} from the review:\n${list}${note.trim() ? `\n\n${note.trim()}` : ""}`;
}
