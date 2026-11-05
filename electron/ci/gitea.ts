import type { Gitea } from "../pull-requests/gitea";
import { ApiError } from "../pull-requests/host";
import type { CiRepo, CiReading } from "./index";
import { statusRuns, type CommitStatus } from "./statuses";

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

/** Statuses a page; Gitea serves 30 by default and at most 50 unless its admin raised it. */
const STATUS_PAGE = 50;
/** A workflow matrix rarely reaches this many jobs on one commit. */
const STATUS_PAGES = 10;

/**
 * The latest status of every context on a commit. Gitea pages the combined
 * status, newest first, so a job that failed early sits past the first page.
 */
async function commitStatuses(client: Gitea, repo: CiRepo, sha: string) {
  const all: CommitStatus[] = [];
  for (let page = 1; page <= STATUS_PAGES; page++) {
    const { data, headers } = await client.request<{
      statuses: CommitStatus[] | null;
    }>(
      `${client.repo(repo)}/commits/${sha}/status?limit=${STATUS_PAGE}&page=${page}`,
    );
    const found = data.statuses ?? [];
    all.push(...found);
    const total = Number(headers.get("x-total-count") ?? all.length);
    if (!found.length || all.length >= total) break;
  }
  return all;
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
  const runs = await commitRuns(client, repo, head.id);
  if (!runs.length) return null;
  return {
    commit: {
      sha: head.id,
      message: head.message?.split("\n")[0],
      author: head.author?.name,
    },
    runs,
  };
}

/** CI on one commit: a pull request's head, which may live on a fork. */
export async function readGiteaCommit(
  client: Gitea,
  repo: CiRepo,
  sha: string,
): Promise<CiReading | null> {
  const runs = await commitRuns(client, repo, sha);
  if (!runs.length) return null;
  const found = await client
    .request<{
      commit: { message?: string; author?: { name?: string } };
    }>(`${client.repo(repo)}/git/commits/${encodeURIComponent(sha)}`)
    .catch(() => null);
  return {
    commit: {
      sha,
      message: found?.data.commit.message?.split("\n")[0],
      author: found?.data.commit.author?.name,
    },
    runs,
  };
}

async function commitRuns(client: Gitea, repo: CiRepo, sha: string) {
  return statusRuns(await commitStatuses(client, repo, sha));
}
