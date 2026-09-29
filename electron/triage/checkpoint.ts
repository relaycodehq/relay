import {
  helperProviderSchema,
  modelSchema,
  reasoningEffortSchema,
} from "../../shared/settings";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  TRIAGE_MODEL,
  TRIAGE_VERSION,
  type TriageResult,
  type TriageState,
} from "../../shared/triage";
import { filePathSchema } from "../../shared/validation";
import { responseSchema, failedReason } from "./classifier";

const reasonSchema = z.string().max(1000);
const pathsSchema = z.array(filePathSchema).max(1000);
const groupSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(80),
  description: z.string().max(600),
  paths: pathsSchema,
});
const resultSchema = z.object({
  version: z.literal(TRIAGE_VERSION),
  revision: z.string(),
  model: modelSchema,
  fast: z.boolean().optional(),
  reasoningEffort: reasoningEffortSchema.default("medium"),
  provider: helperProviderSchema.default("codex"),
  createdAt: z.string(),
  files: z
    .array(
      z.object({
        filename: filePathSchema,
        previous_filename: filePathSchema.optional(),
        status: z.string(),
        additions: z.number(),
        deletions: z.number(),
        changes: z.number(),
      }),
    )
    .max(1000),
  groups: z.array(groupSchema).max(500),
  ordinary: z.record(filePathSchema, reasonSchema),
  incompleteFiles: pathsSchema.optional(),
  usage: z.object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    batches: z.number().int().nonnegative(),
  }),
  notice: z.string().optional(),
});
const candidateSchema = z.object({
  path: filePathSchema,
  hunks: z.number().int().min(0).max(2500),
  evidence: z.string().max(80_000),
  patch: z.string().max(24_000),
  references: z.array(z.string()).max(2500),
  terms: z.array(z.string()).max(256),
});
const checkpointSchema = z.object({
  version: z.literal(1),
  definitions: z.array(responseSchema.shape.groups.element).max(128),
  candidates: z.array(candidateSchema).max(1000),
  decisions: z.record(
    filePathSchema,
    z.object({
      decision: z.enum(["normal", "group"]),
      pattern: z.string(),
      reason: reasonSchema,
      checkedPatterns: z.number().int().nonnegative(),
      coveredHunks: z.array(z.number().int().positive()).max(2500),
    }),
  ),
  scanPending: pathsSchema,
  skipped: z.record(filePathSchema, reasonSchema),
  failures: z.record(
    filePathSchema,
    z.object({
      stage: z.enum(["scan", "discover", "match"]),
      reason: reasonSchema,
    }),
  ),
  preservedGroups: z.array(groupSchema).max(500),
  preservedOrdinary: z.record(filePathSchema, reasonSchema),
  stop: z
    .enum(["budget", "paused", "error", "incomplete", "interrupted"])
    .optional(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export interface SavedAnalysis {
  result: TriageResult;
  checkpoint: Checkpoint;
}
export const freshCheckpoint = (paths: string[]): Checkpoint => ({
  version: 1,
  definitions: [],
  candidates: [],
  decisions: {},
  scanPending: paths,
  skipped: {},
  failures: {},
  preservedGroups: [],
  preservedOrdinary: {},
});
const analysisFile = (dir: string, key: string) =>
  join(
    dir,
    "analysis",
    `${createHash("sha256").update(key).digest("hex")}.json`,
  );
export const groupId = (
  pattern: string,
  revision: string,
  model = TRIAGE_MODEL,
) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        TRIAGE_VERSION,
        "checkpoint-v1",
        pattern,
        revision,
        model,
      ]),
    )
    .digest("hex");
export function pendingWork(c: Checkpoint) {
  return {
    scan: c.scanPending,
    discover: c.candidates
      .filter((x) => !c.decisions[x.path])
      .map((x) => x.path),
    match: c.candidates
      .filter(
        (x) =>
          c.decisions[x.path]?.decision === "normal" &&
          c.decisions[x.path].checkedPatterns < c.definitions.length,
      )
      .map((x) => x.path),
  };
}
export const remainingPaths = (c: Checkpoint) => [
  ...new Set(Object.values(pendingWork(c)).flat()),
];
export const resumable = (c: Checkpoint): TriageState["resume"] => {
  const remaining = remainingPaths(c).length;
  return remaining ? { remaining, reason: c.stop ?? "interrupted" } : undefined;
};
export function restoreState(saved: SavedAnalysis): TriageState {
  const { result, checkpoint } = saved,
    resume = resumable(checkpoint);
  return {
    id: "cached",
    model: result.model,
    fast: result.fast ?? false,
    reasoningEffort: result.reasoningEffort ?? "medium",
    provider: result.provider ?? "codex",
    revision: result.revision,
    status: resume ? "paused" : "complete",
    scanned: result.files.length - checkpoint.scanPending.length,
    total: result.files.length,
    checked: result.files.length - (resume?.remaining ?? 0),
    candidates: result.files.length,
    usage: result.usage,
    result,
    ...(resume ? { resume } : {}),
  };
}

// The old cache omitted provisional rules and queue positions. Keep confirmed
// groups and semantic decisions; recover unfinished work and orphaned singletons.
function recoverLegacy(result: TriageResult): Checkpoint {
  const c = freshCheckpoint([]);
  c.preservedGroups = result.groups;
  const grouped = new Set(result.groups.flatMap((g) => g.paths));
  const partial =
    !!result.notice && /budget reached|stopped early/i.test(result.notice);
  for (const file of result.files) {
    if (grouped.has(file.filename)) continue;
    const reason = result.ordinary[file.filename];
    const invalid = failedReason(reason);
    if (
      !reason ||
      invalid ||
      /^(Analysis budget reached|Analysis context budget reached|Not classified:|File could not be analyzed)/.test(
        reason,
      ) ||
      (partial && reason === "No other confirmed matches")
    ) {
      c.scanPending.push(file.filename);
      if (invalid) c.failures[file.filename] = { stage: "scan", reason };
    } else c.preservedOrdinary[file.filename] = reason;
  }
  c.stop = /budget reached/i.test(result.notice ?? "")
    ? "budget"
    : "interrupted";
  return c;
}

export async function readAnalysis(
  dir: string,
  key: string,
  revision: string,
): Promise<SavedAnalysis | null> {
  const path = analysisFile(dir, key);
  try {
    if ((await stat(path)).size > 64 * 1024 * 1024)
      throw new Error("Analysis checkpoint exceeds its storage limit.");
    const raw = JSON.parse(await readFile(path, "utf8"));
    const result = resultSchema.parse(raw);
    if (result.revision !== revision) return null;
    const checkpoint =
      raw.checkpoint === undefined
        ? recoverLegacy(result)
        : checkpointSchema.parse(raw.checkpoint);
    const paths = new Set(result.files.map((f) => f.filename));
    const grouped = result.groups.flatMap((g) => g.paths);
    const ids = new Set(checkpoint.definitions.map((g) => g.pattern));
    const candidates = new Set(checkpoint.candidates.map((c) => c.path));
    const hunkCounts = new Map(
      checkpoint.candidates.map((c) => [c.path, c.hunks]),
    );
    const owned = [
      ...checkpoint.scanPending,
      ...candidates,
      ...Object.keys(checkpoint.skipped),
      ...checkpoint.preservedGroups.flatMap((g) => g.paths),
      ...Object.keys(checkpoint.preservedOrdinary),
    ];
    if (
      paths.size !== result.files.length ||
      new Set(grouped).size !== grouped.length ||
      new Set(result.groups.map((g) => g.id)).size !== result.groups.length ||
      grouped.some((p) => !paths.has(p) || result.ordinary[p]) ||
      result.groups.some((g) => g.paths.length < 2) ||
      ids.size !== checkpoint.definitions.length ||
      candidates.size !== checkpoint.candidates.length ||
      new Set(owned).size !== owned.length ||
      owned.length !== paths.size ||
      owned.some((p) => !paths.has(p)) ||
      Object.entries(checkpoint.decisions).some(
        ([p, d]) =>
          !candidates.has(p) ||
          d.checkedPatterns > ids.size ||
          (d.decision === "group" &&
            (!ids.has(d.pattern) ||
              d.coveredHunks.length !== hunkCounts.get(p) ||
              new Set(d.coveredHunks).size !== hunkCounts.get(p) ||
              d.coveredHunks.some((h) => h > hunkCounts.get(p)!))) ||
          (d.decision === "normal" &&
            (d.pattern !== "" || d.coveredHunks.length !== 0)),
      ) ||
      Object.keys(checkpoint.failures).some(
        (p) => !remainingPaths(checkpoint).includes(p),
      )
    ) {
      throw new Error("Inconsistent checkpoint");
    }
    result.incompleteFiles ??= Object.entries(result.ordinary)
      .filter(([, r]) => failedReason(r))
      .map(([p]) => p);
    if (
      result.notice ===
      "Some Luna decisions were incomplete. Valid decisions were kept; see individual-file explanations."
    )
      result.notice = result.incompleteFiles.length
        ? `Codex could not finish classifying ${result.incompleteFiles.length} ${result.incompleteFiles.length === 1 ? "file" : "files"}. Resume analysis to retry them.`
        : undefined;
    return { result, checkpoint };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      "The saved analysis checkpoint could not be read. It has been preserved; no work was overwritten.",
      { cause: e },
    );
  }
}
export async function saveAnalysis(
  dir: string,
  key: string,
  saved: SavedAnalysis,
) {
  const target = analysisFile(dir, key),
    tmp = `${target}.${randomUUID()}.tmp`;
  await mkdir(join(dir, "analysis"), { recursive: true, mode: 0o700 });
  const serialized = JSON.stringify({
    ...saved.result,
    checkpoint: saved.checkpoint,
  });
  if (Buffer.byteLength(serialized) > 64 * 1024 * 1024)
    throw new Error(
      "Analysis checkpoint exceeds its storage limit. The previous checkpoint is preserved.",
    );
  const handle = await open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(serialized);
    await handle.sync();
    await handle.close();
    await rename(tmp, target);
  } catch (e) {
    await handle.close().catch(() => {});
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}
