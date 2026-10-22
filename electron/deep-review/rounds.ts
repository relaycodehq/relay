import type { ProjectChat } from "../../shared/projects";
import type { DeepReviewState, ReviewTarget } from "../../shared/deep-review";
import { threadReports } from "../../shared/findings";

/** Saves from before a thread held rounds kept its one review as `deepReview`. */
export function migrateReviewRounds(chat: ProjectChat) {
  const old = chat as ProjectChat & { deepReview?: unknown };
  if (!old.deepReview) return false;
  chat.reviews ??= [old.deepReview as NonNullable<ProjectChat["reviews"]>[0]];
  delete old.deepReview;
  return true;
}

/** The round a main-conversation message falls in: the latest asked for up to it. */
function roundAt(chat: ProjectChat, messageId: string) {
  const byRequest = new Map(chat.reviews?.map((r) => [r.request, r]));
  let current: DeepReviewState | undefined;
  for (const m of chat.messages) {
    if (m.parentId || m.side) continue;
    current = byRequest.get(m.id) ?? current;
    if (m.id === messageId) return current;
  }
}

/** The rounds whose answers published the findings `ids`. */
export function roundsOfFindings(chat: ProjectChat, ids: string[]) {
  const rounds = new Set<DeepReviewState>();
  for (const report of threadReports(chat.findings)) {
    if (!report.findings.some((f) => ids.includes(f.id))) continue;
    const round = roundAt(chat, report.messageId);
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

/** The folder a round reviewed in, and the branch checked out there. */
const reviewedIn = ({ scope }: DeepReviewState) =>
  scope.checkout
    ? `${scope.checkout.path}\n${scope.checkout.branch ?? ""}`
    : `${scope.folder ?? ""}\n${scope.branch ?? ""}`;

/**
 * Whether `asked`'s findings get fixed where `working` has the thread work:
 * it's the same round, the same branch, pull request or commit, or the same
 * folder on the same branch.
 */
export function fixesFit(asked: DeepReviewState, working: DeepReviewState) {
  if (asked === working) return true;
  const what = reviewed(asked.scope.target);
  if (what && what === reviewed(working.scope.target)) return true;
  return reviewedIn(asked) === reviewedIn(working);
}
