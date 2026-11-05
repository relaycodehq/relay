// Getting a thread onto code a round reviewed from Git, so the round's
// findings can be fixed where the thread works.
import type { ProjectChat } from "../../shared/projects";
import type { DeepReviewState, ReviewScope } from "../../shared/deep-review";
import type { PullRef } from "../../shared/types";
import { git } from "../git/git";
import { needsCheckout, openReviewCheckout, pullBranch } from "./checkout";
import { roundsOfFindings } from "./rounds";
import type { PullInfo } from "./scope";

/** A round whose reviewers read the code from Git, as the thread's folder didn't have it. */
export const readFromGit = (round: DeepReviewState) =>
  !round.scope.checkout && needsCheckout(round.scope);

/** Whether `folder` has the reviewed commit checked out, or a later one built on it. */
export const holdsReviewed = (folder: string, scope: ReviewScope) =>
  !!scope.head &&
  git(folder, ["merge-base", "--is-ancestor", scope.head, "HEAD"]).then(
    () => true,
    () => false,
  );

/**
 * The local branch the findings `ids` get fixed on: a reviewed branch
 * itself, or for a pull request the local branch that holds its reviewed
 * head, made at that head when none does, as a deep review's own thread
 * gets one with its first fix.
 */
export async function branchToFix(
  root: string,
  chat: ProjectChat,
  ids: string[],
  pull: (ref: PullRef) => Promise<PullInfo>,
) {
  const { round, head } = roundReadFromGit(chat, ids);
  const { target } = round.scope;
  if (target.kind === "branch" && target.head) return target.head;
  if (target.kind !== "pr")
    throw new Error(`Relay can't check out ${round.scope.label}.`);
  // Without the forge the branch is named pr/<number>.
  const info = await pull(target.ref).catch(() => undefined);
  const pr = {
    number: target.ref.number,
    ...(info?.headBranch ? { head: info.headBranch } : {}),
  };
  const pick = await pullBranch(root, pr, head, true);
  if (!pick)
    throw new Error(`Relay couldn't name a branch for ${round.scope.label}.`);
  if (pick.made) await git(root, ["branch", pick.branch, head]);
  return pick.branch;
}

/**
 * Checks out the code the round behind `ids` reviewed from Git, the way a
 * deep review's own thread checks out what it reviews, and has the round
 * fix there: a branch's folder, or a worktree in `worktrees` on it.
 */
export async function checkOutRound(
  root: string,
  chat: ProjectChat,
  ids: string[],
  worktrees: string,
  pull: (ref: PullRef) => Promise<PullInfo>,
) {
  const { round } = roundReadFromGit(chat, ids);
  const { target } = round.scope;
  // Its head branch names the branch a fix makes; without it, pr/<number>.
  const info =
    target.kind === "pr"
      ? await pull(target.ref).catch(() => undefined)
      : undefined;
  const checkout = await openReviewCheckout(
    root,
    round.scope,
    worktrees,
    chat.id,
    info?.headBranch,
  );
  if (!checkout) throw new Error(`Relay can't check out ${round.scope.label}.`);
  round.scope.checkout = checkout;
  // The thread works where its latest checked-out round does, so later
  // rounds give it up: their findings get checked out again to be fixed.
  const later = chat.reviews!.slice(chat.reviews!.indexOf(round) + 1);
  for (const r of later) delete r.scope.checkout;
  return checkout;
}

/** The round behind the findings `ids` whose reviewers read the code from Git, and the commit they read. */
function roundReadFromGit(chat: ProjectChat, ids: string[]) {
  const round = roundsOfFindings(chat, ids).find(readFromGit);
  const head = round?.scope.head;
  if (!round || !head)
    throw new Error("Those findings are about code this thread already has.");
  return { round, head };
}
