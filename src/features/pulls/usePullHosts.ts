import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Project } from "../../../shared/projects";
import {
  hostKindOf,
  pullHostName,
  sameServer,
} from "../../../shared/source-control";
import type { Account } from "../../../shared/types";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/error-message";
import { hostAccountQuery } from "./useHostAccount";

/**
 * Who the Pull requests page searches as: the Gitea account, the `gh` login,
 * and the `az` login in each Azure DevOps organization your projects are in.
 */
export function usePullHosts(
  gitea: Account | null | undefined,
  projects: Project[] | undefined,
) {
  // A project from a new organization adds it to the page.
  const projectServers = [
    ...new Set((projects ?? []).flatMap((p) => p.repository?.server ?? [])),
  ]
    .sort()
    .join(" ");
  const servers = useQuery({
    queryKey: ["pull-servers", gitea?.id ?? null, projectServers],
    queryFn: () => api.pullServers(),
  });
  const cliServers = (servers.data ?? []).filter(
    (s) => hostKindOf(s) !== "gitea",
  );
  const answers = useQueries({ queries: cliServers.map(hostAccountQuery) });
  const found = answers.flatMap((a) => (a.data ? [a.data] : []));
  const key = [gitea?.id, ...found.map((a) => `${a.server} ${a.id}`)].join();
  const accounts = useMemo(() => [...(gitea ? [gitea] : []), ...found], [key]);
  const failed = answers.findIndex((a) => a.error);
  return {
    accounts,
    /** The servers that could be signed in to, for saying which CLIs to sign in with. */
    servers: servers.data ?? [],
    /** Nothing to show yet while a host hasn't answered; don't say there's none. */
    pending:
      !accounts.length &&
      (servers.isPending || answers.some((a) => a.isPending)),
    /** A CLI is signed in but its host didn't answer. */
    error:
      failed < 0
        ? servers.error
          ? { host: "Relay", message: errorMessage(servers.error) }
          : null
        : {
            host: pullHostName(cliServers[failed]),
            message: errorMessage(answers[failed].error),
          },
    recheck: () => {
      void servers.refetch();
      for (const a of answers) void a.refetch();
    },
    checking: servers.isFetching || answers.some((a) => a.isFetching),
  };
}

/**
 * The account a PR on `server` is reviewed as; a ref saved before refs named
 * their server is the Gitea account's.
 */
export const accountOn = (accounts: Account[], server: string | undefined) =>
  server
    ? accounts.find((a) => sameServer(a.server, server))
    : accounts.find((a) => hostKindOf(a.server) === "gitea");
