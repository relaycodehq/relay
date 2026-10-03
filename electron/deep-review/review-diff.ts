// The diff a deep review covers, for a reviewer that can't run Git itself.
import { chunks } from "../util/chunks";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { git } from "../git/git";
import type { ReviewScope } from "../../shared/deep-review";

/** About 50k tokens; a longer diff is cut and the reviewer reads the rest. */
export const MAX_DIFF = 200_000;

const flags = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--find-renames",
];

export async function reviewDiff(
  root: string,
  scope: ReviewScope,
): Promise<string> {
  const full = await wholeDiff(root, scope);
  if (full.length <= MAX_DIFF) return full;
  const cut = full.lastIndexOf("\n", MAX_DIFF);
  const stat = await statOf(root, scope).catch(() => "");
  return `${full.slice(0, cut > 0 ? cut : MAX_DIFF)}\n\n[Relay cut the diff here. Every changed file:\n${stat.trimEnd()}\nRead the files past the cut to review them.]`;
}

function wholeDiff(root: string, scope: ReviewScope) {
  const opts = { maxBuffer: 64 * 1024 * 1024 };
  if (scope.target.kind === "uncommitted") return uncommitted(root);
  if (scope.base)
    return git(root, ["diff", ...flags, scope.base, scope.head!], opts);
  // A root commit has no parent to diff against.
  return git(root, ["show", ...flags, "--format=", scope.head!], opts);
}

function statOf(root: string, scope: ReviewScope) {
  if (scope.target.kind === "uncommitted")
    return withUntracked(root, (env) =>
      git(root, ["diff", "--stat=200", "HEAD"], { env }),
    );
  return scope.base
    ? git(root, ["diff", "--stat=200", scope.base, scope.head!])
    : git(root, ["show", "--stat=200", "--format=", scope.head!]);
}

function uncommitted(root: string) {
  return withUntracked(root, (env) =>
    git(root, ["diff", ...flags, "HEAD"], {
      env,
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

/**
 * Runs `run` against a copy of the index where new files are marked as
 * intended to add, so `git diff HEAD` shows them too. The real index isn't touched.
 */
async function withUntracked<T>(
  root: string,
  run: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "relay-review-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    const index = (
      await git(root, ["rev-parse", "--git-path", "index"])
    ).trim();
    await copyFile(
      isAbsolute(index) ? index : join(root, index),
      env.GIT_INDEX_FILE,
    ).catch(() => git(root, ["read-tree", "HEAD"], { env }));
    const untracked = (
      await git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    )
      .split("\0")
      .filter(Boolean);
    for (const part of chunks(untracked, 100))
      await git(root, ["add", "--intent-to-add", "--", ...part], { env });
    return await run(env);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
