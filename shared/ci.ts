/** Cancelled, skipped and neutral runs are shown but decide nothing. */
export type CiState = "success" | "failure" | "running" | "skipped";

export interface CiRun {
  workflow: string;
  state: CiState;
  /** The first job that failed, when the source says. */
  failedJob?: string;
  url: string;
  /** When it finished, or started while it's still going. */
  at: number;
}

export interface CiStatus {
  source: "github" | "gitea";
  /** The branch CI ran on: the thread's, or the default one when that has none. */
  branch: string;
  commit: { sha: string; message?: string; author?: string };
  runs: CiRun[];
  /** Commits here that CI hasn't run on yet. */
  ahead: number;
}

const RANK: Record<CiState, number> = {
  skipped: -1,
  success: 0,
  running: 1,
  failure: 2,
};

/**
 * The colour the icon wears and the run a click opens: a failure outranks a
 * run still going, which outranks a pass. A green run that finished after a red
 * one doesn't hide the failure. Null when no run has a verdict.
 */
export function ciSummary(runs: CiRun[]) {
  const counted = runs.filter((r) => r.state !== "skipped");
  if (!counted.length) return null;
  const worst = counted.reduce((a, b) =>
    RANK[b.state] > RANK[a.state] ? b : a,
  );
  const target =
    worst.state === "success"
      ? counted.reduce((a, b) => (b.at > a.at ? b : a))
      : worst;
  return { state: worst.state, target };
}
