import { useQuery } from "@tanstack/react-query";
import type { Project } from "../../../shared/projects";
import { hostKindOf, hostOffMessage } from "../../../shared/source-control";
import type { Account } from "../../../shared/types";
import { api } from "../../lib/api";
import { errorMessage } from "../../../shared/error-message";

/** Who a CLI is signed in as on `server`, asked of `gh` or `az`. */
export const hostAccountQuery = (server: string) => ({
  queryKey: ["host-account", server],
  queryFn: () => api.hostAccount(server),
  staleTime: 5 * 60_000,
});

/**
 * Who Relay reviews a project's pull requests as: the `gh` login for a GitHub
 * repository, the `az` login for an Azure DevOps one, the Gitea account for
 * any other. Null when there's none yet.
 */
export function useHostAccount(
  repository: Project["repository"] | undefined,
  gitea: Account | null | undefined,
) {
  const kind = repository ? hostKindOf(repository.server) : null;
  const cli = kind === "github" || kind === "azure-devops";
  const host = useQuery({
    ...hostAccountQuery(repository?.server ?? ""),
    enabled: cli,
  });
  const error = cli && host.error ? errorMessage(host.error) : null;
  // Turned off, the account it had before stays in the cache but isn't used.
  const off = !!kind && error === hostOffMessage(kind);
  return {
    kind,
    account:
      !repository || off ? null : cli ? (host.data ?? null) : (gitea ?? null),
    /** The CLI is signed in but its host didn't answer, or the host is off. */
    error,
    /** Asks the CLI again, after signing in in a terminal. */
    recheck: () => void host.refetch(),
    checking: cli && host.isFetching,
    /** The first check hasn't answered yet; don't offer to sign in. */
    pending: cli && host.isPending,
  };
}
