import { ApiError, type Gitea } from "../pull-requests/gitea";
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
    await client.request<{ statuses: CommitStatus[] | null }>(
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
    runs: statusRuns(statuses),
  };
}
