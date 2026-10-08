import { useQuery } from "@tanstack/react-query";
import type { Project } from "../../../shared/projects";
import { isGithubServer } from "../../../shared/source-control";
import type { Account } from "../../../shared/types";
import { api } from "../../lib/api";

/**
 * Who Relay reviews a project's pull requests as: the `gh` login for a GitHub
 * repository, the Gitea account for any other. Null when there's none yet.
 */
export function useHostAccount(
  repository: Project["repository"] | undefined,
  gitea: Account | null | undefined,
) {
  const github = isGithubServer(repository?.server);
  const gh = useQuery({
    queryKey: ["github-account"],
    queryFn: () => api.githubAccount(),
    enabled: github,
    staleTime: 5 * 60_000,
  });
  return {
    github,
    account: !repository ? null : github ? (gh.data ?? null) : (gitea ?? null),
    /** Asks `gh` again, after a `gh auth login` in a terminal. */
    recheck: () => void gh.refetch(),
    checking: github && gh.isFetching,
    /** The first `gh` check hasn't answered yet; don't offer to sign in. */
    pending: github && gh.isPending,
  };
}
