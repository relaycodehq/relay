import type { LineQuestion } from "../../shared/questions";
import type { ProjectChat } from "../../shared/projects";
import { AzureCliTokens } from "../azure-devops/cli-token";
import type { GiteaLogin } from "../app/login";
import type { Store } from "../app/store";
import type { PullMergeSource } from "../project-chats/pull-merges";
import type { Projects } from "../projects/projects";
import { AzureLogin } from "./azure-devops/login";
import type { GithubLogin } from "./github-login";
import type { FetchRequest } from "./host";
import { PullHosts } from "./hosts";
import { questionContext } from "./questions";

/**
 * The pull request hosts and what reads from them, as the desktop and the
 * headless Relay both start them.
 */
export function pullRequestHosts({
  store,
  login,
  github,
  projects,
  fetch,
}: {
  store: Store;
  login: GiteaLogin;
  github: GithubLogin;
  projects: Projects;
  fetch: FetchRequest;
}) {
  // Work items and Azure DevOps pull requests share one `az` sign-in.
  const azureTokens = new AzureCliTokens(fetch);
  const hosts = new PullHosts(
    login,
    github,
    new AzureLogin(fetch, azureTokens),
    () => store.get().sourceControl,
  );
  return {
    azureTokens,
    hosts,
    /** What a PR thread's question about lines reads from its host. */
    async evidence(chat: ProjectChat, selection: LineQuestion) {
      if (chat.scope.kind !== "pr")
        throw new Error("This is not a pull request conversation.");
      const repository = projects.get(chat.projectId).repository;
      if (!repository)
        throw new Error(
          "Relay can't match this project to a repository on its host.",
        );
      const client = await hosts.require(repository.server);
      const repo = await projects.linked(chat.projectId, client);
      if (
        repo.owner !== chat.scope.ref.owner ||
        repo.name !== chat.scope.ref.name
      )
        throw new Error("The selected PR does not match this project.");
      return questionContext(client, chat.scope.ref, selection);
    },
    /** What noticing a thread's PR merging asks the hosts; signed out, nothing. */
    merges: {
      repository: async (projectId: string) => {
        const repository = projects.get(projectId).repository;
        const client = repository && (await hosts.current(repository.server));
        return client
          ? projects.linked(projectId, client).catch(() => null)
          : null;
      },
      mergedAmong: async (repo, numbers, signal) =>
        (await hosts.require(repo.server)).mergedAmong(repo, numbers, signal),
      merged: async (repo, number) =>
        !!(await (await hosts.require(repo.server)).pull({ ...repo, number }))
          .merged,
    } satisfies Pick<PullMergeSource, "repository" | "mergedAmong" | "merged">,
  };
}
