import { currentBranch, git } from "../git/git";
import { azureRepoOf, remoteUrl, repoOf } from "../git/repository";
import { configStamp, memo } from "../git/repo-facts";
import type { AzureDevOps } from "../pull-requests/azure-devops/client";
import type { Gitea } from "../pull-requests/gitea";
import type { FetchRequest } from "../pull-requests/host";
import type { CiRun, CiStatus } from "../../shared/ci";
import type { SourceControlKind } from "../../shared/source-control";
import { GitHub } from "./github";
import { GithubCredentials } from "../github";
import { giteaDefaultBranch, readGitea, readGiteaCommit } from "./gitea";
import { azureDefaultBranch, readAzure } from "./azure-devops";

export interface CiRepo {
  owner: string;
  name: string;
  /** Set for an Azure DevOps remote: the organization, whose project is `owner`. */
  server?: string;
}

export interface CiReading {
  commit: CiStatus["commit"];
  runs: CiRun[];
}

type RemoteRepo = CiRepo & { host: string };

// CI is polled every 90s; the remote only changes with the config files.
const remotes = memo<RemoteRepo | null>();

/** `origin`, or the only remote there is, as host and owner/name. */
export async function remoteRepo(root: string) {
  return remotes(root, await configStamp(root), () => readRemoteRepo(root));
}

async function readRemoteRepo(root: string): Promise<RemoteRepo | null> {
  const names = (await git(root, ["remote"])).split("\n").filter(Boolean);
  const name = names.includes("origin") ? "origin" : names[0];
  if (!name) return null;
  const url = remoteUrl((await git(root, ["remote", "get-url", name])).trim());
  if (!url) return null;
  // Azure DevOps paths carry the organization and `_git`, and SSH has its own host.
  const azure = azureRepoOf(url);
  if (azure) return { host: "dev.azure.com", ...azure };
  const repo = repoOf(url);
  return repo && { host: url.hostname.toLowerCase(), ...repo };
}

async function commitsSince(root: string, sha: string) {
  try {
    return Number(
      (await git(root, ["rev-list", "--count", `${sha}..HEAD`])).trim(),
    );
  } catch {
    // CI ran on a commit this clone hasn't fetched.
    return 0;
  }
}

/** A CI host Relay reads, for remotes on `host`. */
interface CiSource {
  kind: SourceControlKind;
  host: string;
  /** As users know it, e.g. "GitHub". */
  name: string;
  read(repo: CiRepo, branch: string): Promise<CiReading | null>;
  /** Unset where CI doesn't report on the head itself: Azure Pipelines builds a PR's merge commit. */
  readCommit?(repo: CiRepo, sha: string): Promise<CiReading | null>;
  defaultBranch(repo: CiRepo): Promise<string>;
}

/** The signed-in hosts CI is read through besides GitHub, which needs no sign-in. */
export interface CiHosts {
  gitea: Gitea | null;
  /** The organization's client; null without an `az` login for it. */
  azure: (server: string) => Promise<AzureDevOps | null>;
}

/**
 * Where CI reports is read off the git remote: github.com through the `gh`
 * login, the connected Gitea server through its account, an Azure DevOps
 * organization's Pipelines through `az`. Anything else has no status.
 */
export class Ci {
  private github: GitHub;

  constructor(
    fetchRequest: FetchRequest,
    credentials = new GithubCredentials(),
  ) {
    this.github = new GitHub(fetchRequest, credentials);
  }

  private sources({ gitea, azure }: CiHosts): CiSource[] {
    const organization = async (repo: CiRepo) => {
      const client = repo.server && (await azure(repo.server));
      if (!client) throw new Error("Sign in to Azure DevOps with `az login`.");
      return { client, repo: { ...repo, server: repo.server! } };
    };
    return [
      {
        kind: "azure-devops",
        host: "dev.azure.com",
        name: "Azure Pipelines",
        read: async (repo, branch) => {
          const at = await organization(repo);
          return readAzure(at.client, at.repo, branch);
        },
        defaultBranch: async (repo) => {
          const at = await organization(repo);
          return azureDefaultBranch(at.client, at.repo);
        },
      },
      {
        kind: "github",
        host: "github.com",
        name: "GitHub",
        read: (repo, branch) => this.github.read(repo, branch),
        readCommit: (repo, sha) => this.github.readCommit(repo, sha),
        defaultBranch: (repo) => this.github.defaultBranch(repo),
      },
      ...(gitea
        ? [
            {
              kind: "gitea" as const,
              host: new URL(gitea.account.server).hostname,
              name: "Gitea",
              read: (repo: CiRepo, branch: string) =>
                readGitea(gitea, repo, branch),
              readCommit: (repo: CiRepo, sha: string) =>
                readGiteaCommit(gitea, repo, sha),
              defaultBranch: (repo: CiRepo) => giteaDefaultBranch(gitea, repo),
            },
          ]
        : []),
    ];
  }

  /**
   * CI on a pull request's head, with no checkout. Read by its commit when
   * that's known, since a fork's branch names nothing in the base repository;
   * phones from before they sent the commit still ask by branch.
   */
  async pullHeadStatus(
    remote: CiRepo & { host: string },
    head: { branch: string; sha?: string },
    hosts: CiHosts,
    isOn: (kind: SourceControlKind) => boolean = () => true,
  ): Promise<CiStatus | null> {
    const source = this.sources(hosts).find(
      (s) => s.host === remote.host && isOn(s.kind),
    );
    if (!source) return null;
    const reading =
      head.sha && source.readCommit
        ? await source.readCommit(remote, head.sha)
        : await source.read(remote, head.branch);
    return reading
      ? { source: source.name, branch: head.branch, ...reading, ahead: 0 }
      : null;
  }

  /** `isOn` says which hosts the user left turned on in Settings. */
  async status(
    root: string,
    hosts: CiHosts,
    isOn: (kind: SourceControlKind) => boolean = () => true,
  ): Promise<CiStatus | null> {
    const remote = await remoteRepo(root);
    if (!remote) return null;
    const source = this.sources(hosts).find(
      (s) => s.host === remote.host && isOn(s.kind),
    );
    if (!source) return null;
    const current = await currentBranch(root);
    let branch = current;
    let reading = current ? await source.read(remote, current) : null;
    // A branch CI hasn't seen yet shows the default branch instead.
    if (!reading) {
      branch = await source.defaultBranch(remote);
      if (branch === current) return null;
      reading = await source.read(remote, branch);
      if (!reading) return null;
    }
    return {
      source: source.name,
      branch,
      ...reading,
      ahead:
        branch === current ? await commitsSince(root, reading.commit.sha) : 0,
    };
  }
}
