import type { ProjectChat } from "../../shared/projects";

/** Saves from before a thread held rounds kept its one review as `deepReview`. */
export function migrateReviewRounds(chat: ProjectChat) {
  const old = chat as ProjectChat & { deepReview?: unknown };
  if (!old.deepReview) return false;
  chat.reviews ??= [old.deepReview as NonNullable<ProjectChat["reviews"]>[0]];
  delete old.deepReview;
  return true;
}
