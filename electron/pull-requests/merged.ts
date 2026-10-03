import type { Pull, Repo } from "../../shared/types";
import type { Gitea } from "./gitea";

/** Closed PRs are read newest-update first, so a merge landing now is on the first page. */
const PAGES = 2;

/**
 * Which of a repository's PRs were merged, from its recently closed ones: a
 * request or two for the whole repository rather than one per PR.
 */
export async function mergedPulls(
  client: Gitea,
  repo: Repo,
  wanted: number[],
  signal: AbortSignal,
): Promise<number[]> {
  const left = new Set(wanted);
  const merged: number[] = [];
  for (let page = 1; page <= PAGES && left.size; page++) {
    const { items, nextPage } = await client.page<Pull>(
      `${client.repo(repo)}/pulls?state=closed&sort=recentupdate`,
      page,
      signal,
    );
    for (const pull of items)
      if (left.delete(pull.number) && pull.merged) merged.push(pull.number);
    if (!nextPage) break;
  }
  return merged;
}
