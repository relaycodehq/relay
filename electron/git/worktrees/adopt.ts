import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ChatWorktree } from "../../../shared/projects";
import { bootstrap } from "./bootstrap";
import { worktreeExists, worktreeHoldsWork } from "./changes";
import { git, type MadeWorktree, commitOf } from "./common";
import { slug, freeName, freeFolder, newBranchProblem } from "./naming";

// Worktrees for threads that arrive from another computer.

/**
 * Why `worktree`, left by a thread that went back to another computer, can't
 * carry on at `tip` when the thread arrives again, if it can't: its branch
 * has commits `tip` lacks, or its folder holds work. Nothing in it is lost
 * moving up to `tip` otherwise.
 */
export async function cantCarryOn(
  root: string,
  worktree: ChatWorktree,
  tip: string,
) {
  const branch = worktree.branch!;
  const behind = await git(root, [
    "merge-base",
    "--is-ancestor",
    `refs/heads/${branch}`,
    tip,
  ]).then(
    () => true,
    () => false,
  );
  if (!behind) return `it has commits on ${branch} that never went back`;
  if (!(await worktreeExists(worktree))) return;
  const held = await worktreeHoldsWork(worktree.path!);
  if (held) return held;
  const on = (await git(worktree.path!, ["branch", "--show-current"])).trim();
  if (on !== branch) return `its folder isn't on ${branch} anymore`;
}

/**
 * A worktree for work that arrived from another computer: a new branch at
 * `commit`, counting its changes from `start` on `from`, as they did there,
 * when this repository has both. The branch keeps `branch`, its name there,
 * when it can be made here, and is `relay/…` after `name` otherwise. `over`
 * is the worktree an earlier trip left on `branch`, cleared by `cantCarryOn`:
 * its folder moves up to `commit` and carries on, ignored files and all.
 * A new folder gets the `.worktreeinclude` files of `includeFrom`, the
 * checkout unless given.
 */
export async function adoptWorktree(
  root: string,
  dir: string,
  name: string,
  commit: string,
  {
    from,
    start,
    branch: wanted,
    over,
    includeFrom = root,
  }: {
    from?: string;
    start?: string;
    branch?: string;
    over?: ChatWorktree;
    includeFrom?: string;
  } = {},
): Promise<MadeWorktree> {
  const local = from && (await commitOf(root, `refs/heads/${from}`));
  const current = (await git(root, ["branch", "--show-current"])).trim();
  const source = local ? from : current || undefined;
  const base =
    (start && (await commitOf(root, start))) ||
    (source &&
      (await git(root, ["merge-base", `refs/heads/${source}`, commit]).then(
        (s) => s.trim(),
        () => undefined,
      ))) ||
    commit;
  const folder = join(dir, slug(basename(root)));
  await mkdir(folder, { recursive: true });
  const kept = over?.branch === wanted ? over : undefined;
  if (kept && (await worktreeExists(kept))) {
    await git(kept.path!, ["merge", "--ff-only", "-q", commit], 120000);
    return {
      path: kept.path!,
      branch: wanted!,
      head: base,
      start: base,
      base,
      ...(source ? { from: source } : {}),
      named: wanted!,
      // The same folder: its setup and ignored files are still there.
      setup: kept.setup ?? "done",
    };
  }
  const named =
    kept || (wanted && !(await newBranchProblem(root, wanted)))
      ? wanted
      : undefined;
  const leaf = named
    ? await freeFolder(
        folder,
        kept?.path ? basename(kept.path) : slug(named.replace(/^relay\//, "")),
      )
    : await freeName(root, folder, slug(name));
  const path = join(folder, leaf);
  const branch = named ?? `relay/${leaf}`;
  await git(root, ["worktree", "prune"]).catch(() => {});
  await git(
    root,
    // A kept branch moves up to the commit; `cantCarryOn` made sure that loses nothing.
    ["worktree", "add", "-q", kept ? "-B" : "-b", branch, path, commit],
    120000,
  );
  return {
    path,
    branch,
    head: base,
    start: base,
    base,
    ...(source ? { from: source } : {}),
    ...(named ? { named } : {}),
    ...(await bootstrap(root, includeFrom, path)),
  };
}
