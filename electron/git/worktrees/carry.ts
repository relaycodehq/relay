import { rm } from "node:fs/promises";
import { apply, commitTree, plan } from "../turn-changes";
import { adoptWorktree } from "./adopt";
import { uncommitted } from "./changes";
import { git, type MadeWorktree, movedRef, copiedRef } from "./common";
import { createWorktree } from "./create";

// Carrying the checkout's uncommitted work into a thread's new worktree.

/**
 * Moves every uncommitted edit in the checkout into a new worktree, as
 * uncommitted edits there, and puts the checkout's files back to its commit.
 * What moved is kept under a ref first. Anything edited while moving stays in
 * the checkout where it merges; when it doesn't, nothing in the checkout changes.
 */
export async function moveIntoWorktree(
  root: string,
  dir: string,
  name: string,
  chatId: string,
): Promise<MadeWorktree> {
  const { head, tree, files } = await uncommitted(root);
  const made = await createWorktree(root, dir, name);
  const paths = files.map((f) => f.path);
  let steps: Awaited<ReturnType<typeof plan>>["steps"] = [];
  try {
    if (made.head !== head)
      throw new Error(
        "The project folder got a new commit while moving. Try again.",
      );
    if (paths.length) {
      // The fresh worktree's files become the snapshot's, unstaged like they were.
      await git(made.path, ["read-tree", "-u", "--reset", tree], 120000);
      await git(made.path, ["reset", "-q"]);
      await git(root, [
        "update-ref",
        movedRef(chatId),
        await commitTree(
          root,
          tree,
          head,
          "Relay: the project folder's edits as they moved into a worktree",
        ),
      ]);
      const planned = await plan(root, paths, tree, head, false);
      if (planned.conflicts.length)
        throw new Error(
          `${planned.conflicts.slice(0, 3).join(", ")}${planned.conflicts.length > 3 ? ` and ${planned.conflicts.length - 3} more` : ""} changed while moving. Try again.`,
        );
      steps = planned.steps;
    }
  } catch (e) {
    await git(root, ["worktree", "remove", "--force", made.path])
      .catch(() => rm(made.path, { recursive: true, force: true }))
      .then(() => git(root, ["branch", "-D", made.branch]))
      .catch(() => {});
    throw e;
  }
  // From here the worktree holds the edits, so it stays even if this fails.
  await apply(root, head, steps);
  // A staged edit would otherwise linger in the checkout's index.
  for (let i = 0; i < paths.length; i += 500)
    await git(root, ["reset", "-q", "--", ...paths.slice(i, i + 500)]);
  return made;
}

/**
 * A new worktree at `source`'s commit, its changes counted from `source`'s
 * branch, holding a copy of the edits `source` hasn't committed, unstaged like
 * they were there. `source` is a checkout or worktree; it stays as it was.
 * Of the ignored files, only what `source`'s `.worktreeinclude` names comes
 * along, and nested repositories don't. The copy is kept
 * under `copiedRef(chatId)`, so its work can be told apart from the copy's.
 */
export async function copyIntoWorktree(
  root: string,
  dir: string,
  name: string,
  source: string,
  chatId: string,
  branch?: string,
): Promise<{ worktree: MadeWorktree; copied: number }> {
  const { head, tree, files } = await uncommitted(source);
  const from =
    (await git(source, ["branch", "--show-current"])).trim() || undefined;
  const worktree = await adoptWorktree(root, dir, name, head, {
    from,
    start: head,
    includeFrom: source,
    ...(branch ? { branch } : {}),
  });
  if (files.length)
    try {
      await git(worktree.path, ["read-tree", "-u", "--reset", tree], 120000);
      await git(worktree.path, ["reset", "-q"]);
      await git(root, [
        "update-ref",
        copiedRef(chatId),
        await commitTree(
          root,
          tree,
          head,
          "Relay: the edits a thread's worktree began with",
        ),
      ]);
    } catch (e) {
      await git(root, ["worktree", "remove", "--force", worktree.path])
        .catch(() => rm(worktree.path, { recursive: true, force: true }))
        .then(() => git(root, ["branch", "-D", worktree.branch]))
        .catch(() => {});
      throw e;
    }
  return { worktree, copied: files.length };
}
