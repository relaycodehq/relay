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

/** One job, check or status, before it's grouped under its workflow. */
export interface CiEntry {
  workflow: string;
  job?: string;
  state: CiState;
  url: string;
  at: number;
}

/**
 * Entries as workflows: the worst state of a workflow's entries decides it,
 * and it opens that entry's page.
 */
export function groupRuns(entries: CiEntry[]): CiRun[] {
  const workflows = new Map<string, CiRun>();
  for (const { workflow, job, state, url, at } of entries) {
    const run = workflows.get(workflow);
    if (!run) {
      workflows.set(workflow, {
        workflow,
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

/**
 * A commit status as an entry. Gitea Actions posts one status per job, named
 * `Workflow / job (event)`; those group under their workflow. Any other CI
 * posting statuses shows as a workflow of its own.
 */
export function statusEntry(s: CommitStatus): CiEntry {
  const [workflow, ...rest] = s.context.split(" / ");
  return {
    workflow: workflow!,
    job: rest.join(" / ").replace(/\s*\([^)]*\)$/, "") || undefined,
    state: statusState(s.state),
    url: s.target_url ?? "",
    at: Date.parse(s.updated_at),
  };
}

export const statusRuns = (statuses: CommitStatus[]) =>
  groupRuns(statuses.map(statusEntry));
