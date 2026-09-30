import { ciRank, type CiRun, type CiState } from "../../shared/ci";

/** A commit status, as GitHub and Gitea both post them. */
export interface CommitStatus {
  context: string;
  state: string;
  target_url?: string | null;
  updated_at: string;
}

function statusState(state: string): CiState {
  switch (state) {
    case "pending":
      return "running";
    case "success":
    case "warning":
      return "success";
    case "error":
    case "failure":
      return "failure";
    default:
      return "skipped";
  }
}

/**
 * Commit statuses as workflows. Gitea Actions posts one status per job,
 * named `Workflow / job (event)`; those group under their workflow. Any other
 * CI posting statuses shows as a workflow of its own.
 */
export function statusRuns(statuses: CommitStatus[]): CiRun[] {
  const workflows = new Map<string, CiRun>();
  for (const s of statuses) {
    const [workflow, ...rest] = s.context.split(" / ");
    const job = rest.join(" / ").replace(/\s*\([^)]*\)$/, "");
    const state = statusState(s.state);
    const at = Date.parse(s.updated_at);
    const url = s.target_url ?? "";
    const run = workflows.get(workflow!);
    if (!run) {
      workflows.set(workflow!, {
        workflow: workflow!,
        state,
        failedJob: state === "failure" && job ? job : undefined,
        url,
        at,
      });
      continue;
    }
    run.at = Math.max(run.at, at);
    if (ciRank[state] > ciRank[run.state]) {
      run.state = state;
      run.url = url || run.url;
    }
    if (state === "failure" && job && !run.failedJob) run.failedJob = job;
  }
  return [...workflows.values()];
}
