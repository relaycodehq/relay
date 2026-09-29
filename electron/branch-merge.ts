import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBranch, git } from "./git";
import { baseCandidates, branches } from "./branches";
import {
  gitOperation,
  pushDestination,
  serializeRepo,
  workingTree,
} from "./working-tree";
import type {
  MergeBranch,
  MergePlan,
  MergeResult,
} from "../shared/branch-merge";

const isAncestor = (root: string, a: string, b: string) =>
  git(root, ["merge-base", "--is-ancestor", a, b]).then(
    () => true,
    () => false,
  );
const revParse = async (root: string, ref: string) =>
  (await git(root, ["rev-parse", "--verify", "--quiet", ref])).trim();

async function defaultBase(root: string, locals: string[]) {
  return (await baseCandidates(root)).find((name) => locals.includes(name));
}

/** Where `worktreepath` puts each local branch that some checkout has open. */
async function openBranches(root: string) {
  const out = await git(root, [
    "for-each-ref",
    "--format=%(refname:short)%00%(worktreepath)",
    "refs/heads/",
  ]);
  return new Map(
    out
      .trim()
      .split("\n")
      .map((row) => row.split("\0") as [string, string])
      .filter(([, path]) => path),
  );
}

export async function mergePlan(
  root: string,
  requestedBase?: string,
): Promise<MergePlan> {
  const [state, list] = await Promise.all([workingTree(root), branches(root)]);
  if (!state.branch)
    throw new Error("Switch to a branch before merging it somewhere.");
  const all = list.branches.filter((b) => !b.remote).map((b) => b.name);
  const fallback = await defaultBase(root, all);
  if (!requestedBase && fallback === state.branch)
    throw new Error(
      `${state.branch} is the main branch; there's nothing to merge it into.`,
    );
  const locals = all.filter((b) => b !== state.branch);
  const base = requestedBase ?? fallback;
  if (!base || !locals.includes(base))
    throw new Error(
      requestedBase
        ? `There is no local branch ${requestedBase} to merge into.`
        : "No main branch to merge into. Pick a target branch.",
    );
  const [baseHead, log, open, destination] = await Promise.all([
    revParse(root, `refs/heads/${base}`),
    git(root, ["log", "-50", "--format=%H %s", `refs/heads/${base}..HEAD`]),
    openBranches(root),
    pushDestination(root, base),
  ]);
  return {
    branch: state.branch,
    head: state.head,
    base,
    baseHead,
    bases:
      fallback && fallback !== state.branch
        ? [fallback, ...locals.filter((b) => b !== fallback)]
        : locals,
    commits: log
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((r) => ({
        sha: r.slice(0, r.indexOf(" ")),
        subject: r.slice(r.indexOf(" ") + 1),
      })),
    fastForward: await isAncestor(root, baseHead, state.head),
    pushTarget: destination?.label ?? null,
    checkedOutAt: open.get(base) ?? null,
    snapshots: log
      .split("\n")
      .filter((r) => / Relay: the checkout('s)? /.test(r)).length,
    uncommitted: state.changes.length,
  };
}

/**
 * Merges the current branch into `base` without switching to it: this folder
 * and its uncommitted work never move. The merge commit, when one is needed,
 * is made in a throwaway worktree. Then `base` moves to it: just the ref, or
 * where another folder has `base` checked out (a thread's worktree landing in
 * the checkout), a fast-forward there, which Git refuses rather than touch a
 * file with uncommitted edits.
 */
export function mergeBranch(
  root: string,
  input: MergeBranch,
): Promise<MergeResult> {
  return serializeRepo(root, async () => {
    const state = await workingTree(root);
    if (state.branch !== input.branch || state.head !== input.head)
      throw new Error("Your branch changed. Reopen the merge to review it.");
    if (await gitOperation(root))
      throw new Error("Finish the current Git operation before merging.");
    const baseRef = `refs/heads/${input.base}`;
    if ((await revParse(root, baseRef)) !== input.baseHead)
      throw new Error(
        `${input.base} changed. Reopen the merge to review it again.`,
      );
    const open = (await openBranches(root)).get(input.base);
    if (open && (await gitOperation(open)))
      throw new Error(
        `Finish the Git operation in ${open} before merging into ${input.base}.`,
      );
    const destination = input.push
      ? await pushDestination(root, input.base)
      : null;
    if (input.push && !destination)
      throw new Error(`${input.base} has no push remote.`);

    // Build on what the remote has, so the push isn't rejected as stale.
    let start = input.baseHead;
    if (destination) {
      const remote = await git(
        root,
        ["fetch", "--quiet", destination.remote, destination.ref],
        60000,
      )
        .then(() => revParse(root, "FETCH_HEAD"))
        .catch(() => "");
      if (remote && remote !== start) {
        if (await isAncestor(root, start, remote)) start = remote;
        else if (!(await isAncestor(root, remote, start)))
          throw new Error(
            `${input.base} and ${destination.label} have diverged. Sync ${input.base} first.`,
          );
      }
    }

    let sha = input.head;
    const fastForward = await isAncestor(root, start, input.head);
    if (!fastForward) {
      const dir = await mkdtemp(join(tmpdir(), "relay-merge-"));
      try {
        await git(root, ["worktree", "add", "--detach", "--quiet", dir, start]);
        try {
          await git(
            dir,
            [
              "merge",
              "--no-ff",
              "-m",
              `Merge branch '${input.branch}' into ${input.base}`,
              input.head,
            ],
            120000,
          );
        } catch (e) {
          const conflicts = (
            await git(dir, ["diff", "--name-only", "--diff-filter=U"]).catch(
              () => "",
            )
          )
            .trim()
            .split("\n")
            .filter(Boolean);
          if (!conflicts.length) throw e;
          return { merged: false, conflicts };
        }
        sha = await revParse(dir, "HEAD");
      } finally {
        await git(root, ["worktree", "remove", "--force", dir]).catch(() =>
          rm(dir, { recursive: true, force: true }),
        );
        await git(root, ["worktree", "prune"]).catch(() => {});
      }
    }

    const push = () =>
      git(
        root,
        [
          "push",
          "--porcelain",
          destination!.remote,
          `${sha}:${destination!.ref}`,
        ],
        120000,
      );
    if (open) {
      // The checkout moves first: its edits can stop the merge, and then nothing was pushed.
      await serializeRepo(open, () =>
        git(open, ["merge", "--ff-only", "--quiet", sha], 120000),
      ).catch((e: Error) => {
        throw new Error(
          /overwritten/.test(e.message)
            ? `${input.base} in ${open} has uncommitted edits to files this merge changes. Commit or stash them there first.\n\n${e.message}`
            : e.message,
        );
      });
      if (destination)
        await push().catch((e: Error) => {
          throw new Error(
            `Merged into ${input.base}, but pushing it failed: ${e.message}`,
          );
        });
    } else {
      // Push before moving the local ref, so a rejected push changes nothing.
      if (destination) await push();
      await git(root, ["update-ref", baseRef, sha, input.baseHead]);
    }
    return {
      merged: true,
      base: input.base,
      sha,
      fastForward,
      pushedTo: destination?.label ?? null,
    };
  });
}

/**
 * Merges `base` into the current branch, the usual fix when landing it
 * conflicts. Conflicts stay in this folder, marked, to resolve and commit.
 */
export function catchUpBranch(root: string, base: string) {
  return serializeRepo(root, async () => {
    if (await gitOperation(root))
      throw new Error("Finish the current Git operation first.");
    if (!(await revParse(root, `refs/heads/${base}`).catch(() => "")))
      throw new Error(`There is no local branch ${base}.`);
    try {
      await git(root, ["merge", "--no-edit", `refs/heads/${base}`], 120000);
      return { conflicts: [] as string[] };
    } catch (e) {
      const conflicts = (
        await git(root, ["diff", "--name-only", "--diff-filter=U"]).catch(
          () => "",
        )
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      if (!conflicts.length) throw e;
      return { conflicts };
    }
  });
}

/** Deletes a branch that is already merged; Git refuses anything else. */
export function deleteMergedBranch(root: string, name: string) {
  return serializeRepo(root, async () => {
    if ((await currentBranch(root)) === name)
      throw new Error("Switch to another branch before deleting this one.");
    await git(root, ["branch", "-d", "--", name]);
  });
}
