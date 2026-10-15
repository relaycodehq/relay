// Files a thread's agents wrote outside its folder, found by the repository
// they sit in, and what's still uncommitted of them there.
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ElsewhereEdits } from "../../shared/elsewhere";
import type { TurnFileChange } from "../../shared/projects";
import { workingPathSchema, type WorkingTree } from "../../shared/working-tree";
import { git } from "./git";
import { parseNumstat } from "./turn-changes";
import { workingTree } from "./working-tree";

const inside = (path: string, folder: string) => {
  const rel = relative(folder, path);
  return !rel || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Where agents keep their own notes and scratch files, which nobody reviews as changes. */
const agentScratch = () => [
  join(homedir(), ".claude"),
  join(homedir(), ".codex"),
  tmpdir(),
  "/tmp",
  "/private/tmp",
  "/private/var/folders",
];

/** The nearest folder of `path` that exists, for a file since deleted. */
async function existingFolder(path: string) {
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if (
      await stat(dir).then(
        (s) => s.isDirectory(),
        () => false,
      )
    )
      return dir;
    if (dirname(dir) === dir) return null;
  }
}

export const topLevel = (folder: string) =>
  git(folder, ["rev-parse", "--show-toplevel"]).then(
    (out) => resolve(out.trim()),
    () => null,
  );

/**
 * The paths among `edited` (absolute, or relative to `root`) that lie in
 * another Git repository than `root`'s, under each one's top folder.
 */
export async function outsideEdits(
  root: string,
  edited: string[],
  skipped = agentScratch(),
): Promise<ElsewhereEdits[]> {
  const notWork = (path: string) => skipped.some((f) => inside(path, f));
  const outside = [
    ...new Set(
      edited
        .map((p) => resolve(root, p))
        .filter((p) => !inside(p, root) && !notWork(p)),
    ),
  ];
  if (!outside.length) return [];
  const own = await topLevel(root);
  const tops = new Map<string, string | null>();
  const found = new Map<string, Set<string>>();
  for (const path of outside) {
    const folder = await existingFolder(path);
    if (!folder) continue;
    if (!tops.has(folder)) tops.set(folder, await topLevel(folder));
    const top = tops.get(folder);
    // Git names the top folder with links resolved; the path may not be.
    const real = top && (await realpath(folder).catch(() => folder));
    if (!top || !real || top === own || notWork(top)) continue;
    const rel = relative(top, join(real, relative(folder, path)))
      .split(sep)
      .join("/");
    if (!workingPathSchema.safeParse(rel).success) continue;
    found.set(top, (found.get(top) ?? new Set()).add(rel));
  }
  return [...found].map(([top, paths]) => ({
    root: top,
    paths: [...paths].sort(),
  }));
}

/** Untracked files larger than this aren't read to count their lines: they show as added, with none. */
const COUNTED_BYTES = 1024 * 1024;

/** A text file's lines, for one Git doesn't track yet. */
async function lineCount(path: string) {
  const size = await stat(path).then(
    (s) => (s.isFile() ? s.size : 0),
    () => 0,
  );
  if (!size || size > COUNTED_BYTES) return 0;
  const bytes = await readFile(path).catch(() => null);
  if (!bytes?.length || bytes.includes(0)) return 0;
  let lines = 0;
  for (let i = bytes.indexOf(10); i !== -1; i = bytes.indexOf(10, i + 1))
    lines++;
  return bytes[bytes.length - 1] === 10 ? lines : lines + 1;
}

export interface Uncommitted {
  tree: WorkingTree;
  files: (TurnFileChange & { added?: true; deleted?: true })[];
}

/** Which of `paths` still differ from HEAD in `root`, by how many lines. */
export async function uncommitted(
  root: string,
  paths: string[],
): Promise<Uncommitted> {
  const tree = await workingTree(root);
  const wanted = new Set(paths);
  const changed = tree.changes.filter((c) => wanted.has(c.path));
  const tracked = changed.filter((c) => c.index !== "?").map((c) => c.path);
  const counts = new Map(
    (tracked.length && tree.head
      ? parseNumstat(
          await git(root, [
            "diff",
            "--numstat",
            "-z",
            "HEAD",
            "--",
            ...tracked,
          ]),
        )
      : []
    ).map((f) => [f.path, f]),
  );
  const files = await Promise.all(
    changed.map(async (c) => {
      const added = c.index === "?" || c.index === "A",
        deleted = c.worktree === "D" || (c.index === "D" && c.worktree === " ");
      const counted = counts.get(c.path) ?? {
        path: c.path,
        additions: c.index === "?" ? await lineCount(join(root, c.path)) : 0,
        deletions: 0,
      };
      return {
        ...counted,
        ...(added ? { added: true as const } : {}),
        ...(deleted ? { deleted: true as const } : {}),
      };
    }),
  );
  return { tree, files };
}
