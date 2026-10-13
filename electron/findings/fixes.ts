// The findings a fix request covers, from when it's sent until its answer ends.
import {
  threadReports,
  type FindingStatus,
  type ThreadFindings,
} from "../../shared/findings";
import type { ProjectChatSend } from "../../shared/projects";

/** Marks the findings `input` asks the agent to fix as being fixed. */
export function startFixing(
  findings: ThreadFindings | undefined,
  input: ProjectChatSend,
) {
  const known = new Set(
    threadReports(findings).flatMap((r) => r.findings.map((f) => f.id)),
  );
  const ids = (input.fixes ?? []).filter((id) => known.has(id));
  if (!findings || !ids.length) return;
  findings.statuses ??= {};
  for (const id of ids) findings.statuses[id] = "fixing";
  (findings.fixing ??= {})[input.id] = ids;
}

/**
 * Settles what `request` was fixing: fixed when its answer completed, open
 * again otherwise. False when it wasn't a fix request.
 */
export function settleFixes(
  findings: ThreadFindings | undefined,
  request: string | undefined,
  fixed: boolean,
) {
  const fixes = request ? findings?.fixing?.[request] : undefined;
  if (!findings || !fixes) return false;
  for (const id of fixes)
    if (findings.statuses?.[id] === "fixing")
      findings.statuses[id] = fixed ? "fixed" : "open";
  delete findings.fixing![request!];
  return true;
}

/** A fix that was running when the app closed left its findings open. */
export function reopenFixes(findings: ThreadFindings | undefined) {
  if (!findings?.fixing) return false;
  let reopened = false;
  for (const id of Object.values(findings.fixing).flat())
    if (findings.statuses?.[id] === "fixing") {
      findings.statuses[id] = "open";
      reopened = true;
    }
  delete findings.fixing;
  return reopened;
}

/** Sets a finding's status by hand; says which answer's report holds it. */
export function setFindingStatus(
  findings: ThreadFindings | undefined,
  findingId: string,
  status: Extract<FindingStatus, "open" | "dismissed">,
) {
  const report = threadReports(findings).find((r) =>
    r.findings.some((f) => f.id === findingId),
  );
  if (!findings || !report)
    throw new Error("That finding is no longer in this thread.");
  const statuses = (findings.statuses ??= {});
  if (statuses[findingId] === "fixing")
    throw new Error("The agent is fixing this one right now.");
  statuses[findingId] = status;
  return report.messageId;
}
