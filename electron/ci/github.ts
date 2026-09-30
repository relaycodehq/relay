import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findExecutable } from "../executables";
import { networkError } from "../network-errors";
import { readBounded } from "../../shared/http";
import type { FetchRequest } from "../gitea";
import type { CiRun, CiState } from "../../shared/ci";
import type { CiRepo, CiReading } from "./index";
import { statusRuns, type CommitStatus } from "./statuses";

const exec = promisify(execFile);
const API = "https://api.github.com";
const MAX_JSON = 4 * 1024 * 1024;
const MAX_CACHED = 200;

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

export function githubRunState(run: GithubRun): CiState {
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

/** Borrows the `gh` CLI's login; without one, public repositories still read. */
async function ghToken() {
  try {
    const gh = await findExecutable("gh");
    const { stdout } = await exec(
      gh,
      ["auth", "token", "--hostname", "github.com"],
      { timeout: 5000, encoding: "utf8" },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export class GitHub {
  private token?: Promise<string | null>;
  /** Unchanged answers come back as 304s, which don't count against the rate limit. */
  private cache = new Map<string, { etag: string; data: unknown }>();
  private failedJobs = new Map<string, string | undefined>();
  constructor(private fetchRequest: FetchRequest) {}

  private async get<T>(path: string): Promise<T> {
    const token = await (this.token ??= ghToken());
    const cached = this.cache.get(path);
    const response = await this.fetchRequest(API + path, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cached ? { "If-None-Match": cached.etag } : {}),
      },
      credentials: "omit",
      signal: AbortSignal.timeout(20000),
    }).catch((error: unknown) => {
      throw networkError(error, API);
    });
    if (response.status === 304 && cached) return cached.data as T;
    if (!response.ok) {
      await response.body?.cancel();
      // Picks up a fresh `gh auth login` on the next poll.
      if (response.status === 401) this.token = undefined;
      throw new Error(
        response.status === 401
          ? "GitHub rejected the gh login. Run `gh auth login` again."
          : response.status === 403 || response.status === 429
            ? token
              ? "GitHub is rate limiting requests. Status resumes shortly."
              : "GitHub is rate limiting requests. Sign in with `gh auth login` for a higher limit."
            : response.status === 404
              ? token
                ? "GitHub can't find this repository, or your gh login can't see it."
                : "Sign in with `gh auth login` so Relay can read this repository's Actions."
              : `GitHub returned HTTP ${response.status}.`,
      );
    }
    const data = JSON.parse(
      await readBounded(
        response,
        MAX_JSON,
        "GitHub returned more data than Relay can safely handle.",
      ),
    ) as T;
    const etag = response.headers.get("etag");
    if (etag) {
      this.cache.delete(path);
      this.cache.set(path, { etag, data });
      if (this.cache.size > MAX_CACHED)
        this.cache.delete(this.cache.keys().next().value!);
    }
    return data;
  }

  private repoPath(repo: CiRepo) {
    return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  }

  async defaultBranch(repo: CiRepo) {
    return (await this.get<{ default_branch: string }>(this.repoPath(repo)))
      .default_branch;
  }

  private async failedJob(repo: CiRepo, run: GithubRun) {
    const key = `${run.id}:${run.run_attempt ?? 1}`;
    if (!this.failedJobs.has(key)) {
      const jobs = await this.get<{
        jobs: { name: string; conclusion: string | null }[];
      }>(
        `${this.repoPath(repo)}/actions/runs/${run.id}/attempts/${run.run_attempt ?? 1}/jobs?per_page=100`,
      ).catch(() => null);
      if (!jobs) return undefined;
      this.failedJobs.set(
        key,
        jobs.jobs.find((j) => j.conclusion === "failure")?.name,
      );
    }
    return this.failedJobs.get(key);
  }

  async read(repo: CiRepo, branch: string): Promise<CiReading | null> {
    const ref = `heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
    const [{ workflow_runs }, tip] = await Promise.all([
      this.get<{ workflow_runs: GithubRun[] }>(
        `${this.repoPath(repo)}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=30&exclude_pull_requests=true`,
      ),
      // CI outside Actions, like a build machine of your own, posts commit statuses.
      this.get<{ sha: string; statuses: CommitStatus[] }>(
        `${this.repoPath(repo)}/commits/${ref}/status`,
      ).catch(() => null),
    ]);
    const latest = latestGithubRuns(workflow_runs);
    const statuses = tip ? statusRuns(tip.statuses) : [];
    // Statuses are all the branch tip has so far; any Actions runs are older.
    if (tip && statuses.length && tip.sha !== latest?.head.head_sha) {
      const found = await this.get<{
        commit: { message?: string; author?: { name?: string } };
      }>(`${this.repoPath(repo)}/commits/${tip.sha}`).catch(() => null);
      return {
        commit: {
          sha: tip.sha,
          message: found?.commit.message?.split("\n")[0],
          author: found?.commit.author?.name,
        },
        runs: statuses,
      };
    }
    if (!latest) return null;
    const runs = await Promise.all(
      latest.runs.map(async (r): Promise<CiRun> => {
        const state = githubRunState(r);
        return {
          workflow: r.name || "Workflow",
          state,
          failedJob:
            state === "failure" ? await this.failedJob(repo, r) : undefined,
          url: r.html_url,
          at: Date.parse(
            state === "running"
              ? (r.run_started_at ?? r.created_at)
              : r.updated_at,
          ),
        };
      }),
    );
    const commit = latest.head.head_commit;
    return {
      commit: {
        sha: latest.head.head_sha,
        message: commit?.message?.split("\n")[0],
        author: commit?.author?.name,
      },
      runs: [...runs, ...statuses],
    };
  }
}
