import type { Issue } from "../../shared/types";
import { GITHUB_SERVER } from "../../shared/source-control";
import type { PullState, SearchFilter } from "./host";

export interface GithubIssue extends Omit<
  Issue,
  "body" | "repository" | "pull_request"
> {
  body: string | null;
  draft?: boolean;
  repository_url: string;
  pull_request?: { merged_at: string | null };
}

const searchQualifiers: Record<SearchFilter, string> = {
  review_requested: "review-requested:@me",
  assigned: "assignee:@me",
  created: "author:@me",
  all: "involves:@me",
};

/**
 * GitHub's search for the Pull requests page. A bare search stays among PRs
 * you're part of, since all of GitHub is noise; one that names a repo, org or
 * user searches there instead.
 */
export function searchQuery(filter: SearchFilter, q: string, state: PullState) {
  const scoped = filter === "all" && /\b(repo|org|user|owner):\S/.test(q);
  return [
    "is:pr",
    "archived:false",
    scoped ? "" : searchQualifiers[filter],
    state === "all" ? "" : `is:${state}`,
    q.trim(),
  ]
    .filter(Boolean)
    .join(" ");
}

export const asIssue = (i: GithubIssue): Issue & { draft?: boolean } => {
  const [owner = "", name = ""] = i.repository_url
    .replace(/^.*\/repos\//, "")
    .split("/");
  const { repository_url: _, pull_request, ...rest } = i;
  return {
    ...rest,
    body: i.body ?? "",
    repository: {
      owner,
      name,
      full_name: `${owner}/${name}`,
      server: GITHUB_SERVER,
    },
    pull_request: { merged: !!pull_request?.merged_at },
  };
};
