// Which worktree a thread carrying on an existing branch works in.

import type {
  ChatSummary,
  ChatWorktree,
  ProjectChat,
} from "../../shared/projects";
import { joinableWorktrees, joinedWorktree } from "../../shared/projects";
import {
  checkedOutAt,
  createWorktree,
  localBranchName,
  sameFolder,
  worktreeExists,
} from "../git/worktrees";
import { noteWorkspaceMove } from "../../shared/workspace-moves";
import type { ChatCore } from "./core";

/**
 * The open thread on `name` whose worktree another thread can join: the
 * folder Git has the branch checked out in now, not only its record, which
 * a folder removed by hand, or switched to another branch by its agent,
 * outlives. A remote `origin/…` means its local twin when there is one.
 */
export async function joinableOn<
  T extends Pick<ProjectChat, "id" | "worktree" | "archivedAt" | "sentTo">,
>(root: string, chats: readonly T[], name: string) {
  const branch = await localBranchName(root, name);
  const at = await checkedOutAt(root, branch);
  if (!at) return;
  for (const c of joinableWorktrees(chats))
    if (
      c.worktree!.branch === branch &&
      (await sameFolder(c.worktree!.path!, at))
    )
      return c;
}

/**
 * The worktree a thread carrying on `branch` works in: the folder of an
 * open thread on it, shared; the folder it's checked out in already, unless
 * that's an away thread's; a worktree of its own, which threads keeping the branch for their next
 * message work in too; or, when only checking it out is in the way, a new
 * branch off it. Never a refusal: a branch gone meanwhile goes off the
 * checkout's commit, and the thread says so.
 */
export async function carriedOn(
  core: ChatCore,
  /** The folder Relay makes threads' worktrees in. */
  folder: string,
  chat: ProjectChat,
  root: string,
  branch: string,
  name: string,
): Promise<ChatWorktree> {
  const others = (core.store.get().chats ?? []).filter(
    (c) => c.id !== chat.id && c.projectId === chat.projectId,
  );
  const open = await joinableOn(root, others, branch);
  if (open) return joinedWorktree((await core.storage.load(open.id)).worktree!);
  // Threads' records have local names; `origin/feature` is their `feature`.
  const local = await localBranchName(root, branch);
  // A thread away on another computer holds its folder for the work
  // landing there once it's back; nothing else works in it meanwhile.
  const away = others.find(
    (c) =>
      !c.archivedAt &&
      c.sentTo &&
      c.worktree?.branch === local &&
      !!c.worktree.path &&
      !c.worktree.removedAt &&
      !c.worktree.cleanedUp,
  );
  if (away) {
    const off = await createWorktree(
      root,
      folder,
      name,
      { startFrom: { off: branch } },
      false,
    );
    return off.wanted
      ? off
      : {
          ...off,
          wanted: {
            branch,
            problem: `“${away.title}” is away on ${away.sentTo!.computer} with it, so the thread is on a new branch off it.`,
          },
        };
  }
  const made = await createWorktree(
    root,
    folder,
    name,
    { startFrom: { on: branch } },
    false,
  );
  if (made.branch !== local || made.adopted) return made;
  await handToKeepers(core, others, local, made.path);
  return made;
}

/**
 * Hands the folder just made on `local` to the threads keeping that branch
 * for their next message, so they find it there.
 */
async function handToKeepers(
  core: ChatCore,
  others: readonly ChatSummary[],
  local: string,
  path: string,
) {
  // Whoever kept the branch for its next message finds it here, the
  // same folder for both, rather than wanting it back on its own. Not a
  // thread away on another computer, whose work lands here once it's
  // back, nor a copy left from an earlier trip, which passed its folder on.
  const keeping = others.filter(
    (c) =>
      !c.archivedAt &&
      !c.sentTo &&
      !c.cameFrom?.returnedAt &&
      !!c.worktree?.path &&
      c.worktree.branch === local,
  );
  // In the repository's queue, which `root` runs this in, rather than
  // under their controls; see `ThreadWorktrees.remake`.
  for (const other of keeping) {
    const them = await core.storage.load(other.id);
    const theirs = them.worktree;
    if (theirs?.branch !== local || (await worktreeExists(theirs))) continue;
    const {
      removedAt: _removed,
      cleanedUp: _cleaned,
      included: _included,
      adopted: _adopted,
      portOffset: _offset,
      ...kept
    } = theirs;
    // This thread runs the folder's setup; one run serves both, and
    // whichever sends first waits for it.
    them.worktree = { ...kept, path: path, setup: "done" };
    noteWorkspaceMove(them, {
      how: "recreated",
      to: path,
      branch: local,
      unasked: true,
    });
    await core.storage.save(them);
  }
}
