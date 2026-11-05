import type { CiRun, CiState } from "../../shared/ci";
import { groupRuns, statusEntry, type CiEntry } from "./statuses";

export interface GithubRun {
  id: number;
  name: string | null;
  head_sha: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  workflow_id: number;
  run_attempt?: number;
  run_started_at?: string | null;
  created_at: string;
  updated_at: string;
  head_commit?: { message?: string; author?: { name?: string } } | null;
}

export function githubRunState(
  run: Pick<GithubRun, "status" | "conclusion">,
): CiState {
  // Queued, in progress, waiting for a runner or for approval.
  if (run.status !== "completed") return "running";
  switch (run.conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
    case "startup_failure":
      return "failure";
    case "action_required":
      return "running";
    default:
      return "skipped";
  }
}

/**
 * The newest commit that has runs, and the latest run of each workflow on it.
 * The API lists newest first, and a re-run keeps its run id, so the first run
 * per workflow is the current one.
 */
export function latestGithubRuns(runs: GithubRun[]) {
  const head = runs[0];
  if (!head) return null;
  const seen = new Set<number>();
  const latest = runs.filter(
    (r) =>
      r.head_sha === head.head_sha &&
      !seen.has(r.workflow_id) &&
      !!seen.add(r.workflow_id),
  );
  return { head, runs: latest };
}

export type RollupContext =
  | {
      __typename: "CheckRun";
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl: string | null;
      startedAt: string | null;
      completedAt: string | null;
      checkSuite: {
        workflowRun: { url: string; workflow: { name: string } } | null;
      } | null;
    }
  | {
      __typename: "StatusContext";
      context: string;
      state: string;
      targetUrl: string | null;
      createdAt: string;
    };

/** A commit's checks and statuses as workflows: an Actions job under its workflow, any other check or status on its own. */
export function rollupRuns(contexts: (RollupContext | null)[]): CiRun[] {
  return groupRuns(
    contexts.flatMap((c): CiEntry[] => {
      if (c?.__typename === "StatusContext")
        return [
          statusEntry({
            context: c.context,
            state: c.state.toLowerCase(),
            target_url: c.targetUrl,
            updated_at: c.createdAt,
          }),
        ];
      if (c?.__typename !== "CheckRun") return [];
      const state = githubRunState({
        status: c.status.toLowerCase(),
        conclusion: c.conclusion?.toLowerCase() ?? null,
      });
      const run = c.checkSuite?.workflowRun;
      const at = state === "running" ? c.startedAt : c.completedAt;
      return [
        {
          workflow: run?.workflow.name ?? c.name,
          job: run ? c.name : undefined,
          state,
          url: run?.url ?? c.detailsUrl ?? "",
          at: Date.parse(at ?? c.startedAt ?? "") || 0,
        },
      ];
    }),
  );
}
