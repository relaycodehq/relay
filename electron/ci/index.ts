import { git } from "../git";
import { remoteUrl } from "../repository";
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
  const parts = url?.pathname
    .replace(/\.git\/?$/, "")
    .split("/")
    .filter(Boolean);
  if (!url || !parts || parts.length < 2) return null;
  const [owner, repo] = parts.slice(-2);
  return { host: url.hostname.toLowerCase(), owner: owner!, name: repo! };
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

  async status(root: string, gitea: Gitea | null): Promise<CiStatus | null> {
    const remote = await remoteRepo(root);
    if (!remote) return null;
    const source =
      remote.host === "github.com"
        ? "github"
        : gitea && remote.host === new URL(gitea.account.server).hostname
          ? "gitea"
          : null;
    if (!source) return null;
    const read = (branch: string) =>
      source === "github"
        ? this.github.read(remote, branch)
        : readGitea(gitea!, remote, branch);
    const current = (await git(root, ["branch", "--show-current"])).trim();
    let branch = current;
    let reading = current ? await read(current) : null;
    // A branch CI hasn't seen yet shows the default branch instead.
    if (!reading) {
      branch =
        source === "github"
          ? await this.github.defaultBranch(remote)
          : await giteaDefaultBranch(gitea!, remote);
      if (branch === current) return null;
      reading = await read(branch);
      if (!reading) return null;
    }
    return {
      source,
      branch,
      ...reading,
      ahead:
        branch === current ? await commitsSince(root, reading.commit.sha) : 0,
    };
  }
}
