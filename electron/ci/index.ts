import { currentBranch, git } from "../git";
import { remoteUrl, repoOf } from "../repository";
import type { FetchRequest, Gitea } from "../gitea";
import type { CiRun, CiStatus } from "../../shared/ci";
import { GitHub } from "./github";
import { giteaDefaultBranch, readGitea } from "./gitea";

export interface CiRepo {
  owner: string;
  name: string;
}
export interface CiReading {
  commit: CiStatus["commit"];
  runs: CiRun[];
}

/** `origin`, or the only remote there is, as host and owner/name. */
export async function remoteRepo(root: string) {
  const names = (await git(root, ["remote"])).split("\n").filter(Boolean);
  const name = names.includes("origin") ? "origin" : names[0];
  if (!name) return null;
  const url = remoteUrl((await git(root, ["remote", "get-url", name])).trim());
  const repo = url && repoOf(url);
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
  host: string;
  /** As users know it, e.g. "GitHub". */
  name: string;
  read(repo: CiRepo, branch: string): Promise<CiReading | null>;
  defaultBranch(repo: CiRepo): Promise<string>;
}

/**
 * Where CI reports is read off the git remote: github.com through the `gh`
 * login, the connected Gitea server through its account. Anything else has
 * no status.
 */
export class Ci {
  private github: GitHub;
  constructor(fetchRequest: FetchRequest) {
    this.github = new GitHub(fetchRequest);
  }

  private sources(gitea: Gitea | null): CiSource[] {
    return [
      {
        host: "github.com",
        name: "GitHub",
        read: (repo, branch) => this.github.read(repo, branch),
        defaultBranch: (repo) => this.github.defaultBranch(repo),
      },
      ...(gitea
        ? [
            {
              host: new URL(gitea.account.server).hostname,
              name: "Gitea",
              read: (repo: CiRepo, branch: string) =>
                readGitea(gitea, repo, branch),
              defaultBranch: (repo: CiRepo) => giteaDefaultBranch(gitea, repo),
            },
          ]
        : []),
    ];
  }

  async status(root: string, gitea: Gitea | null): Promise<CiStatus | null> {
    const remote = await remoteRepo(root);
    if (!remote) return null;
    const source = this.sources(gitea).find((s) => s.host === remote.host);
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
