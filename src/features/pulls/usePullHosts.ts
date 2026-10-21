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
import { errorMessage } from "../../../shared/error-message";
import { hostAccountQuery } from "./useHostAccount";

/**
 * Who the Pull requests page searches as: the Gitea account, the `gh` login,
 * and the `az` login in each Azure DevOps organization your projects are in.
 */
export function usePullHosts(
  gitea: Account | null | undefined,
  projects: Project[] | undefined,
  /** Servers a PR link or the PR left open is on, though no project is. */
  linked: (string | undefined)[] = [],
) {
  // A project from a new organization adds it to the page.
  const projectServers = [
    ...new Set((projects ?? []).flatMap((p) => p.repository?.server ?? [])),
  ]
    .sort()
    .join(" ");
  const linkedServers = [
    ...new Set(linked.filter((s): s is string => !!s)),
  ].sort();
  const servers = useQuery({
    queryKey: [
      "pull-servers",
      gitea?.id ?? null,
      projectServers,
      linkedServers.join(" "),
    ],
    queryFn: () => api.pullServers(linkedServers),
  });
  const cliServers = (servers.data ?? []).filter(
    (s) => hostKindOf(s) !== "gitea",
  );
  const answers = useQueries({ queries: cliServers.map(hostAccountQuery) });
  const found = answers.flatMap((a) => (a.data ? [a.data] : []));
  const key = [gitea?.id, ...found.map(accountKey)].join();
  const accounts = useMemo(() => [...(gitea ? [gitea] : []), ...found], [key]);
  const failed = answers.findIndex((a) => a.error);
  return {
    accounts,
    /** Hosts a project is on whose CLI answered that it isn't signed in. */
    signedOut: cliServers.filter(
      (s, i) =>
        answers[i].data === null &&
        projects?.some(
          (p) => !!p.repository?.server && sameServer(p.repository.server, s),
        ),
    ),
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

/** Who an account is: an `az` or `gh` login keeps its id when the user changes. */
export const accountKey = (a: Account) =>
  `${a.server} ${a.id} ${a.user.id} ${a.user.login}`;

/** What to run in a terminal to sign in to `server`'s CLI. */
export const signInCommand = (server: string) =>
  hostKindOf(server) === "azure-devops" ? "az login" : "gh auth login";

/**
 * The account a PR on `server` is reviewed as; a ref saved before refs named
 * their server is the Gitea account's.
 */
export const accountOn = (accounts: Account[], server: string | undefined) =>
  server
    ? accounts.find((a) => sameServer(a.server, server))
    : accounts.find((a) => hostKindOf(a.server) === "gitea");
