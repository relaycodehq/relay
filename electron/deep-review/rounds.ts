import type { ProjectChat } from "../../shared/projects";
import {
  messageRounds,
  workingReview,
  type DeepReviewState,
  type ReviewTarget,
} from "../../shared/deep-review";
import { threadReports } from "../../shared/findings";

/** Saves from before a thread held rounds kept its one review as `deepReview`. */
export function migrateReviewRounds(chat: ProjectChat) {
  const old = chat as ProjectChat & { deepReview?: unknown };
  if (!old.deepReview) return false;
  chat.reviews ??= [old.deepReview as NonNullable<ProjectChat["reviews"]>[0]];
  delete old.deepReview;
  return true;
}

/** The rounds whose answers published the findings `ids`. */
export function roundsOfFindings(chat: ProjectChat, ids: string[]) {
  const roundOf = messageRounds(chat.messages, chat.reviews);
  const rounds = new Set<DeepReviewState>();
  for (const report of threadReports(chat.findings)) {
    if (!report.findings.some((f) => ids.includes(f.id))) continue;
    const round = roundOf.get(report.messageId);
    if (round) rounds.add(round);
  }
  return [...rounds];
}

/** What a round reviewed, when another round can name the same: a branch, pull request or commit. */
function reviewed(t: ReviewTarget) {
  switch (t.kind) {
    case "branch":
      return t.head && `branch:${t.head}`;
    case "pr":
      return `pr:${t.ref.owner}/${t.ref.name}#${t.ref.number}`;
    case "commit":
      return `commit:${t.sha}`;
    case "uncommitted":
      return undefined;
  }
}

/**
 * Whether `asked`'s findings get fixed where the thread works now: in a
 * deep review's own thread, where `working` has it. They do for the same
 * round, or one that reviewed the same branch, pull request or commit, or
 * one whose checkout holds the same branch: a branch is checked out in one
 * folder at most. A checkout with no branch holds one commit, which a later
 * round may have moved it off, so it only fits its own round. A round that
 * made no checkout reviewed where the thread worked then: it fits while the
 * round that had the thread there still has it, or, with none, while the
 * thread is still on the branch it was.
 */
export function fixesFit(
  chat: ProjectChat,
  asked: DeepReviewState,
  working: DeepReviewState | undefined,
) {
  if (asked === working) return true;
  const what = reviewed(asked.scope.target);
  if (what && working && what === reviewed(working.scope.target)) return true;
  if (asked.scope.checkout) {
    const branch = asked.scope.checkout.branch;
    return !!branch && branch === working?.scope.checkout?.branch;
  }
  const then = workingReview({
    reviews: chat.reviews?.slice(0, chat.reviews.indexOf(asked)),
  });
  if (then || working) return then === working;
  return asked.scope.branch === chat.branch;
}
