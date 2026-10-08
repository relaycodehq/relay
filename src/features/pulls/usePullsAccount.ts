import { useQuery } from "@tanstack/react-query";
import type { Account } from "../../../shared/types";
import { api } from "../../lib/api";

/**
 * Who the Pull requests page searches as: the Gitea account when one is
 * connected, since that's a choice someone made, else the `gh` login.
 */
export function usePullsAccount(gitea: Account | null | undefined) {
  const gh = useQuery({
    queryKey: ["github-account"],
    queryFn: () => api.githubAccount(),
    enabled: !gitea,
    staleTime: 5 * 60_000,
  });
  return {
    account: gitea ?? gh.data ?? null,
    /** The first `gh` check hasn't answered yet; don't say there's no host. */
    pending: !gitea && gh.isPending,
    recheck: () => void gh.refetch(),
    checking: gh.isFetching,
  };
}
