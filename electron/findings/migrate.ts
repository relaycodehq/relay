import type { PublishedReport, ThreadFindings } from "../../shared/findings";
import type { ProjectChat } from "../../shared/projects";
import { publishFindings } from "./reports";

/** Where a deep review kept its findings before any thread could have them. */
interface ReviewFindings {
  report?: PublishedReport;
  reports?: PublishedReport[];
  statuses?: ThreadFindings["statuses"];
  fixing?: ThreadFindings["fixing"];
}

/**
 * Moves an older save's findings from its deep review to the thread, and
 * publishes blocks that ended a lead's answer but never reached the review,
 * like one from a turn the lead started itself. Only review threads are
 * looked at: before every thread could publish findings, a block anywhere
 * else was quoted, not meant. Says whether the thread changed.
 */
export function migrateFindings(chat: ProjectChat) {
  const review = chat.deepReview as
    (ProjectChat["deepReview"] & ReviewFindings) | undefined;
  if (!review) return false;
  let changed = false;
  if (review.report || review.reports || review.statuses || review.fixing) {
    const { report, reports = [], statuses, fixing } = review;
    chat.findings = {
      reports: [...(report ? [report] : []), ...reports],
      ...(statuses ? { statuses } : {}),
      ...(fixing ? { fixing } : {}),
    };
    delete review.report;
    delete review.reports;
    delete review.statuses;
    delete review.fixing;
    changed = true;
  }
  for (const m of chat.messages)
    if (m.role === "assistant" && m.status === "complete" && !m.parentId)
      changed = publishFindings(chat, m) || changed;
  return changed;
}
