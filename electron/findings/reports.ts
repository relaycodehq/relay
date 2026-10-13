import {
  checkoutPaths,
  extractFindings,
  threadReports,
  type FindingsReport,
  type ThreadFindings,
} from "../../shared/findings";
import type { ChatMessage, ProjectChat } from "../../shared/projects";

/** Adds a batch without letting reused IDs change an older finding's status. */
export function addReport(
  findings: ThreadFindings,
  report: FindingsReport,
  messageId: string,
  body: string,
  root?: string,
) {
  const previous = threadReports(findings);
  if (previous.some((r) => r.messageId === messageId)) return body;
  const used = new Set(previous.flatMap((r) => r.findings.map((f) => f.id)));
  let next =
    Math.max(
      0,
      ...[...used, ...report.findings.map((f) => f.id)].map((id) =>
        Number(id.slice(1)),
      ),
    ) + 1;
  const renamed = new Map<string, string>();
  const batch = {
    ...checkoutPaths(report, root),
    messageId,
  };
  for (const finding of batch.findings) {
    if (used.has(finding.id)) {
      const id = `F${next++}`;
      renamed.set(finding.id, id);
      finding.id = id;
    }
    used.add(finding.id);
  }
  findings.reports.push(batch);
  return body.replace(/`(F\d+)`/g, (match, id: string) =>
    renamed.has(id) ? `\`${renamed.get(id)}\`` : match,
  );
}

/**
 * Moves the findings block that ends `answer` into the thread's reports,
 * shown under that answer. Says whether there was one.
 */
export function publishFindings(
  chat: ProjectChat,
  answer: ChatMessage,
  root?: string,
) {
  if (threadReports(chat.findings).some((r) => r.messageId === answer.id))
    return false;
  const { body, report } = extractFindings(answer.body);
  if (!report) return false;
  chat.findings ??= { reports: [] };
  answer.body = addReport(chat.findings, report, answer.id, body, root);
  answer.version++;
  return true;
}
