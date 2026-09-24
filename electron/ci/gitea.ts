import { ApiError, type Gitea } from "../gitea";
import type { CiRun, CiState } from "../../shared/ci";
import type { CiRepo, CiReading } from "./index";

export interface GiteaStatus {
  context: string;
  state: string;
  target_url?: string | null;
  updated_at: string;
}

const RANK: Record<CiState, number> = {
  skipped: -1,
  success: 0,
  running: 1,
  failure: 2,
};

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
export function giteaRuns(statuses: GiteaStatus[]): CiRun[] {
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
    if (RANK[state] > RANK[run.state]) {
      run.state = state;
      run.url = url || run.url;
    }
    if (state === "failure" && job && !run.failedJob) run.failedJob = job;
  }
  return [...workflows.values()];
}

const defaults = new Map<string, { branch: string; at: number }>();

export async function giteaDefaultBranch(client: Gitea, repo: CiRepo) {
  const key = `${client.account.server} ${repo.owner}/${repo.name}`;
  const cached = defaults.get(key);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.branch;
  const branch = (
    await client.request<{ default_branch: string }>(client.repo(repo))
  ).data.default_branch;
  defaults.set(key, { branch, at: Date.now() });
  return branch;
}

export async function readGitea(
  client: Gitea,
  repo: CiRepo,
  branch: string,
): Promise<CiReading | null> {
  let head: {
    id: string;
    message?: string;
    author?: { name?: string };
  };
  try {
    head = (
      await client.request<{ commit: typeof head }>(
        `${client.repo(repo)}/branches/${encodeURIComponent(branch)}`,
      )
    ).data.commit;
  } catch (e) {
    // Not pushed yet.
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
  const { statuses } = (
    await client.request<{ statuses: GiteaStatus[] | null }>(
      `${client.repo(repo)}/commits/${head.id}/status`,
    )
  ).data;
  if (!statuses?.length) return null;
  return {
    commit: {
      sha: head.id,
      message: head.message?.split("\n")[0],
      author: head.author?.name,
    },
    runs: giteaRuns(statuses),
  };
}
