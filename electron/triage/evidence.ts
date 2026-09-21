import { posix } from "node:path";
import { structuredPatch, formatPatch } from "diff";
import type { ChangedFile, FilePair } from "../../shared/types";

export interface Candidate {
  path: string;
  hunks: number;
  evidence: string;
  patch: string;
  references: string[];
  terms: string[];
}

export const MAX_BATCH_FILES = 12;

/** Prepare complete changes for semantic classification. No framework, language or
 * refactor allowlist: similarity helps batch files, never decides eligibility. */
export function prepareCandidate(
  file: ChangedFile,
  pair: FilePair,
): Candidate | string {
  if (pair.binary) return "Binary content needs individual review";
  if (
    (!pair.old && file.status !== "added") ||
    (!pair.next && file.status !== "deleted")
  )
    return "Incomplete file content";
  const before = pair.old?.contents ?? "",
    after = pair.next?.contents ?? "";
  if (before.includes("\ufffd") || after.includes("\ufffd"))
    return "Unsupported text encoding";
  if (before === after && file.status !== "renamed") return "No text changes";
  const patch = structuredPatch(
    file.previous_filename ?? file.filename,
    file.filename,
    before,
    after,
    undefined,
    undefined,
    { context: 6, timeout: 40, maxEditLength: 2500 },
  );
  if (!patch)
    return "Could not produce a complete diff within the analysis budget";
  const completePatch = formatPatch(patch);
  if (completePatch.length > 24_000)
    return "Complete diff exceeds the per-file analysis budget";
  const changes = patch.hunks
    .flatMap((h) => h.lines.filter((l) => /^[+-]/.test(l)))
    .join("\n");
  // Vocabulary is a retrieval hint, never a required exact edit signature.
  const terms = [
    ...new Set(
      changes.match(/[\p{L}_$][\p{L}\p{N}_$]{1,63}|\?\?|\?\.|=>|===|!==/gu) ??
        [],
    ),
  ].slice(0, 256);
  const references = [
    ...new Set(
      [
        ...completePatch.matchAll(
          /["']((?:\.{1,2}\/|[\w@-]+\/)[^\s"'`<>]{1,200})["']/g,
        ),
      ].map((m) => m[1]),
    ),
  ];
  return {
    path: file.filename,
    hunks: patch.hunks.length,
    patch: completePatch,
    references,
    terms,
    evidence: JSON.stringify({
      path: file.filename,
      previousPath: file.previous_filename,
      status: file.status,
      hunkCount: patch.hunks.length,
      completePatch,
      context: {
        scope:
          "Every changed hunk is included with six surrounding lines. Unchanged code elsewhere is omitted; choose normal if it is needed to interpret the change.",
      },
    }),
  };
}

/** Referenced context is shared once per request, including when the referenced
 * file is itself a candidate. Every candidate still carries its complete diff. */
export function serializeBatch(candidates: Candidate[]) {
  const paths = new Set(candidates.map((c) => c.path));
  const related = new Map<string, { path: string; completePatch: string }>();
  const files = candidates.map((c) => {
    const { relatedChanges = [], ...evidence } = JSON.parse(c.evidence);
    for (const change of relatedChanges)
      if (!paths.has(change.path)) related.set(change.path, change);
    return {
      ...evidence,
      path: c.path,
      hunkCount: c.hunks,
      requiredHunks: Array.from({ length: c.hunks }, (_, i) => i + 1),
      relatedPaths: relatedChanges.map((r: { path: string }) => r.path),
    };
  });
  return JSON.stringify({
    candidates: files,
    relatedChanges: [...related.values()],
  });
}

/** Include small, directly referenced changed files without reading the project.
 * Resolve relative paths and unique alias suffixes against this PR's file list. */
export function addRelatedChanges(
  c: Candidate,
  all: Map<string, Candidate>,
): Candidate {
  const paths = [...all.keys()];
  const related = new Set<string>();
  const stem = (path: string) =>
    path
      .replace(/\.(?:[cm]?[jt]sx?|json|css|scss|sass|less|py|php|h|hpp)$/, "")
      .replace(/\/index$/, "");
  for (const ref of c.references) {
    const target = stem(
      ref.startsWith(".")
        ? posix.normalize(posix.join(posix.dirname(c.path), ref))
        : ref,
    );
    const found = paths.filter((path) =>
      ref.startsWith(".")
        ? stem(path) === target
        : stem(path).endsWith("/" + target),
    );
    if (found.length === 1 && found[0] !== c.path) related.add(found[0]);
  }
  if (!related.size) return c;
  let size = 0;
  const included: { path: string; completePatch: string }[] = [],
    omitted: string[] = [];
  for (const path of related) {
    const patch = all.get(path)!.patch;
    if (included.length < 3 && size + patch.length <= 12_000) {
      included.push({ path, completePatch: patch });
      size += patch.length;
    } else omitted.push(path);
  }
  return {
    ...c,
    evidence: JSON.stringify({
      ...JSON.parse(c.evidence),
      relatedChanges: included,
      relatedContextOmitted: omitted,
    }),
  };
}

/** Neighbor ordering improves discovery within small batches. Every eligible
 * candidate reaches Luna, even when its similarity to all others is zero. */
export function takeBatch(pending: Candidate[]): Candidate[] {
  const first = pending.shift();
  if (!first) return [];
  const terms = new Set(first.terms);
  const similarity = (c: Candidate) => {
    const common = c.terms.filter((t) => terms.has(t)).length;
    return common / (terms.size + c.terms.length - common || 1);
  };
  pending.sort(
    (a, b) => similarity(b) - similarity(a) || a.path.localeCompare(b.path),
  );
  const batch = [first];
  for (let i = 0; i < pending.length && batch.length < MAX_BATCH_FILES;) {
    const c = pending[i];
    if (serializeBatch([...batch, c]).length > 60_000) {
      i++;
      continue;
    }
    batch.push(c);
    pending.splice(i, 1);
  }
  return batch;
}
