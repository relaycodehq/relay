import { basename, dirname, join } from "node:path";
import { branchNameProblem } from "../../../shared/branch-names";
import type { ChatWorktree } from "../../../shared/projects";
import { git, exists, hasBranch, relayBranch } from "./common";

// Where a thread's worktree goes and what its branch is called.

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "thread";

/**
 * A folder name in `dir` that's free, and whose `relay/…` branch is too,
 * unless that's `own`: a thread cleaned up with its branch kept takes its
 * folder back when it carries on.
 */
export async function freeName(
  root: string,
  dir: string,
  name: string,
  own?: string,
) {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`;
    const relay = `relay/${candidate}`;
    if (
      (relay === own || !(await hasBranch(root, relay))) &&
      !(await exists(join(dir, candidate)))
    )
      return candidate;
  }
}

export async function freeFolder(dir: string, name: string) {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`;
    if (!(await exists(join(dir, candidate)))) return candidate;
  }
}

/**
 * Moves a worktree the first message just made, before anything runs in it,
 * from the folder and `relay/…` branch named after the message to ones named
 * after the thread's `title`. Resolves to where it went; undefined when it
 * stays, already named after it or on a branch the user named.
 */
export async function retitleWorktree(
  root: string,
  worktree: ChatWorktree,
  title: string,
) {
  const { path, branch } = worktree;
  if (!path || worktree.named || branch !== `relay/${basename(path)}`) return;
  const name = slug(title);
  for (let n = 1; ; n++) {
    const leaf = n === 1 ? name : `${name}-${n}`;
    if (leaf === basename(path)) return;
    const to = join(dirname(path), leaf);
    if ((await hasBranch(root, `relay/${leaf}`)) || (await exists(to)))
      continue;
    await git(root, ["worktree", "move", path, to]);
    try {
      await git(root, ["branch", "-m", branch, `relay/${leaf}`]);
    } catch (error) {
      await git(root, ["worktree", "move", to, path]).catch(() => {});
      throw error;
    }
    return { path: to, branch: `relay/${leaf}` };
  }
}

/**
 * Why `branch` can't be made for a new worktree, if it can't: git wouldn't
 * take the name, or it, a branch above it or one below it already exists.
 */
export async function newBranchProblem(root: string, branch: string) {
  const format = branchNameProblem(branch);
  if (format) return format;
  if (
    await git(root, ["check-ref-format", `refs/heads/${branch}`]).then(
      () => false,
      () => true,
    )
  )
    return "Git doesn't take that as a branch name.";
  if (await hasBranch(root, branch)) return `${branch} already exists.`;
  const parts = branch.split("/");
  for (let i = 1; i < parts.length; i++) {
    const above = parts.slice(0, i).join("/");
    if (await hasBranch(root, above))
      return `There's a branch called ${above}, so ${branch} can't be made.`;
  }
  const below = (
    await git(root, [
      "for-each-ref",
      "--count=1",
      "--format=%(refname:short)",
      `refs/heads/${branch}/`,
    ])
  ).trim();
  if (below)
    return `There's a branch called ${below}, so ${branch} can't be made.`;
}

/** Where the worktree goes and on which branch: the one the user named, or `relay/…` after `name`. */
export async function placeFor(
  root: string,
  folder: string,
  name: string,
  previous?: ChatWorktree,
) {
  const named = previous?.named;
  let wanted: ChatWorktree["wanted"];
  if (named) {
    const problem = await newBranchProblem(root, named);
    if (!problem) {
      const leaf = previous.path
        ? basename(previous.path)
        : slug(named.replace(/^relay\//, ""));
      return { leaf: await freeName(root, folder, leaf, named), branch: named };
    }
    // Taken since it was typed; the thread says so rather than not starting.
    if (!previous.path) wanted = { branch: named, problem };
  }
  const leaf =
    previous && relayBranch(previous) && previous.branch !== named
      ? await freeName(root, folder, basename(previous.path!))
      : await freeName(root, folder, slug(name));
  return { leaf, branch: `relay/${leaf}`, ...(wanted ? { wanted } : {}) };
}
