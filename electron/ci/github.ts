import { networkError } from "../util/network-errors";
import { readBounded } from "../../shared/http";
import type { FetchRequest } from "../pull-requests/host";
import { GithubCredentials } from "../github";
import type { CiRun } from "../../shared/ci";
import type { CiRepo, CiReading } from "./index";
import {
  githubRunState,
  latestGithubRuns,
  rollupRuns,
  type GithubRun,
  type RollupContext,
} from "./github-runs";
import { statusRuns, type CommitStatus } from "./statuses";

const API = "https://api.github.com";
const MAX_JSON = 4 * 1024 * 1024;
const MAX_CACHED = 200;

/** Commit statuses a page, GitHub's most. */
const STATUS_PAGE = 100;
/** A commit rarely carries more contexts than this. */
const STATUS_PAGES = 5;

/** How far back a branch is walked for a commit CI reported on, 100 commits a page. */
const HISTORY_PAGES = 5;
/** How many pages of one commit's checks and statuses are read, 100 a page. */
const CONTEXT_PAGES = 10;

const CONTEXTS = `pageInfo { hasNextPage endCursor }
  nodes {
    __typename
    ... on CheckRun { name status conclusion detailsUrl startedAt completedAt checkSuite { workflowRun { url workflow { name } } } }
    ... on StatusContext { context state targetUrl createdAt }
  }`;

const HISTORY_QUERY = `query($owner: String!, $name: String!, $ref: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target {
        ... on Commit {
          history(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              oid
              messageHeadline
              author { name }
              statusCheckRollup { contexts(first: 100) { ${CONTEXTS} } }
            }
          }
        }
      }
    }
  }
}`;

const COMMIT_QUERY = `query($owner: String!, $name: String!, $oid: GitObjectID!, $after: String) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        oid
        messageHeadline
        author { name }
        statusCheckRollup { contexts(first: 100, after: $after) { ${CONTEXTS} } }
      }
    }
  }
}`;

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface RollupContexts {
  pageInfo?: PageInfo;
  nodes: (RollupContext | null)[];
}

interface RollupCommit {
  oid: string;
  messageHeadline: string;
  author: { name: string | null } | null;
  statusCheckRollup: { contexts: RollupContexts } | null;
}

interface HistoryAnswer {
  repository: {
    ref: {
      target: { history?: { pageInfo: PageInfo; nodes: RollupCommit[] } };
    } | null;
  } | null;
}

interface CommitAnswer {
  repository: { object: RollupCommit | null } | null;
}

/** Where a reading without a login looks: which Actions runs, and whose commit statuses. */
function restTarget(at: { branch: string } | { sha: string }) {
  if ("sha" in at) {
    const sha = encodeURIComponent(at.sha);
    return { runs: `head_sha=${sha}`, ref: sha };
  }
  return {
    runs: `branch=${encodeURIComponent(at.branch)}`,
    ref: `heads/${at.branch.split("/").map(encodeURIComponent).join("/")}`,
  };
}

export class GitHub {
  /** Unchanged answers come back as 304s, which don't count against the rate limit. */
  private cache = new Map<string, { etag: string; data: unknown }>();
  /** The token the cache was filled under; a private repo's answer must not outlive its login. */
  private cacheToken: string | null = null;
  private failedJobs = new Map<string, string | undefined>();

  constructor(
    private fetchRequest: FetchRequest,
    private credentials = new GithubCredentials(),
  ) {}

  /** A GET, or a POST of `body` (never cached). */
  private async get<T>(path: string, body?: unknown): Promise<T> {
    const credential = this.credentials.read();
    const value = await credential;
    const { token } = value;
    if (this.credentials.isCurrent(credential) && token !== this.cacheToken) {
      this.cache.clear();
      this.failedJobs.clear();
      this.cacheToken = token;
    }
    const cached =
      body === undefined && this.cacheToken === token
        ? this.cache.get(path)
        : undefined;
    const response = await this.fetchRequest(API + path, {
      ...(body !== undefined
        ? { method: "POST", body: JSON.stringify(body) }
        : {}),
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
      // Picks up a fresh `gh auth login` on the next poll, including one made
      // after a tokenless request hit a private repo or the anonymous limit.
      if (
        this.credentials.isCurrent(credential) &&
        (response.status === 401 ||
          (!token && [403, 404, 429].includes(response.status)))
      ) {
        value.rejected();
        this.cache.clear();
        this.failedJobs.clear();
        this.cacheToken = null;
      }
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
    const etag = body === undefined && response.headers.get("etag");
    if (
      etag &&
      this.credentials.isCurrent(credential) &&
      this.cacheToken === token
    ) {
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

  /**
   * The newest commit on `branch` that CI reported on. Signed in, that walks
   * back past commits CI never saw (a build machine that only posts statuses
   * for releases); without a login GraphQL is closed, so only the tip's
   * statuses and the Actions runs count.
   */
  async read(repo: CiRepo, branch: string): Promise<CiReading | null> {
    return (await this.credentials.read()).token
      ? this.readHistory(repo, branch)
      : this.readTip(repo, { branch });
  }

  /**
   * CI on one commit: a pull request's head, which a fork's branch of any
   * name may hold, so its branch name says nothing in this repository.
   */
  async readCommit(repo: CiRepo, sha: string): Promise<CiReading | null> {
    if (!(await this.credentials.read()).token)
      return this.readTip(repo, { sha });
    const answer = await this.graphql<CommitAnswer>(COMMIT_QUERY, {
      owner: repo.owner,
      name: repo.name,
      oid: sha,
      after: null,
    });
    const commit = answer.repository?.object;
    return commit ? this.rollupReading(repo, commit) : null;
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const answer: {
      data?: T;
      errors?: { type?: string; message: string }[];
    } = await this.get("/graphql", { query, variables });
    if (answer.errors?.length || !answer.data)
      throw new Error(
        answer.errors?.[0]?.type === "NOT_FOUND"
          ? "GitHub can't find this repository, or your gh login can't see it."
          : `GitHub refused the CI query: ${answer.errors?.[0]?.message ?? "no answer"}`,
      );
    return answer.data;
  }

  private async readHistory(
    repo: CiRepo,
    branch: string,
  ): Promise<CiReading | null> {
    let after: string | null = null;
    for (let page = 0; page < HISTORY_PAGES; page++) {
      const answer: HistoryAnswer = await this.graphql(HISTORY_QUERY, {
        owner: repo.owner,
        name: repo.name,
        ref: `refs/heads/${branch}`,
        after,
      });
      const history = answer.repository?.ref?.target.history;
      if (!history) return null;
      for (const commit of history.nodes) {
        const reading = await this.rollupReading(repo, commit);
        if (reading) return reading;
      }
      if (!history.pageInfo.hasNextPage) return null;
      after = history.pageInfo.endCursor;
    }
    return null;
  }

  /**
   * The latest status of every context on the commit `ref` points at. GitHub
   * pages them, 30 by default; later pages go by the sha the first one named,
   * so a push in between can't mix two commits' statuses.
   */
  private async tipStatuses(repo: CiRepo, ref: string) {
    const page = (at: string, n: number) =>
      this.get<{ sha: string; statuses: CommitStatus[] }>(
        `${this.repoPath(repo)}/commits/${at}/status?per_page=${STATUS_PAGE}&page=${n}`,
      );
    const tip = await page(ref, 1);
    const statuses = [...tip.statuses];
    let last = tip.statuses;
    // The page body is all `get` keeps of a cached answer, so a short page, not the Link header, says it was the last.
    for (let n = 2; n <= STATUS_PAGES && last.length === STATUS_PAGE; n++) {
      last = (await page(tip.sha, n)).statuses;
      statuses.push(...last);
    }
    return { sha: tip.sha, statuses };
  }

  /** A commit's checks and statuses, or null when CI reported nothing on it. */
  private async rollupReading(
    repo: CiRepo,
    commit: RollupCommit,
  ): Promise<CiReading | null> {
    const contexts = commit.statusCheckRollup?.contexts;
    if (!contexts?.nodes.length) return null;
    const runs = rollupRuns(await this.allContexts(repo, commit.oid, contexts));
    if (!runs.length) return null;
    return {
      commit: {
        sha: commit.oid,
        message: commit.messageHeadline || undefined,
        author: commit.author?.name ?? undefined,
      },
      runs,
    };
  }

  /** The pages after `first`, so a failure past the first 100 checks still shows. */
  private async allContexts(repo: CiRepo, oid: string, first: RollupContexts) {
    const nodes = [...first.nodes];
    let pageInfo = first.pageInfo;
    for (let page = 1; page < CONTEXT_PAGES && pageInfo?.hasNextPage; page++) {
      const answer: CommitAnswer = await this.graphql(COMMIT_QUERY, {
        owner: repo.owner,
        name: repo.name,
        oid,
        after: pageInfo.endCursor,
      });
      const next = answer.repository?.object?.statusCheckRollup?.contexts;
      if (!next) break;
      nodes.push(...next.nodes);
      pageInfo = next.pageInfo;
    }
    return nodes;
  }

  /** Without a login: the Actions runs and commit statuses on a branch's tip, or on one commit. */
  private async readTip(
    repo: CiRepo,
    at: { branch: string } | { sha: string },
  ): Promise<CiReading | null> {
    const target = restTarget(at);
    const [{ workflow_runs }, tip] = await Promise.all([
      this.get<{ workflow_runs: GithubRun[] }>(
        `${this.repoPath(repo)}/actions/runs?${target.runs}&per_page=30&exclude_pull_requests=true`,
      ),
      // CI outside Actions, like a build machine of your own, posts commit statuses.
      this.tipStatuses(repo, target.ref).catch(() => null),
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
