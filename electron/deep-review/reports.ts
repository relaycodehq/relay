import {
  checkoutPaths,
  reviewReports,
  type DeepReviewState,
  type FindingsReport,
} from "../../shared/deep-review";

/** Adds a batch without letting reused IDs change an older finding's status. */
export function addReport(
  state: DeepReviewState,
  report: FindingsReport,
  messageId: string,
  body: string,
  root: string,
) {
  const previous = reviewReports(state);
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
  if (state.report) (state.reports ??= []).push(batch);
  else state.report = batch;
  return body.replace(/`(F\d+)`/g, (match, id: string) =>
    renamed.has(id) ? `\`${renamed.get(id)}\`` : match,
  );
}
