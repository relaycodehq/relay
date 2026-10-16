import { realpath } from "node:fs/promises";
import type { LocalFolder, Repo } from "../../shared/types";
import {
  azureGitPath,
  azureServer,
  GITHUB_SERVER,
  isAzureServer,
} from "../../shared/source-control";
import { git as gitIn } from "./git";
const git = async (path: string, args: string[], signal?: AbortSignal) =>
  (
    await gitIn(path, args, { timeout: 10000, maxBuffer: 1024 * 1024, signal })
  ).trim();
/** A remote as a URL, reading scp-style `user@host:path` as SSH. */
export function remoteUrl(raw: string): URL | null {
  try {
    return new URL(
      raw.includes("://")
        ? raw
        : raw.replace(/^([^@]+@)?([^:]+):/, "ssh://$2/"),
    );
  } catch {
    return null;
  }
}

/**
 * Whether a remote points at the forge on `host`. An SSH remote's host is the
 * SSH endpoint, which is often an alias or another domain than the web address
 * (`~/.ssh/config` hosts, `ssh.example.com`), so only HTTP remotes must match it.
 */
export function remoteOnHost(remote: URL, host: string) {
  return (
    remote.protocol === "ssh:" ||
    remote.hostname.toLowerCase() === host.toLowerCase()
  );
}

/** The owner and name a remote's last two path segments give; null with fewer. */
export function repoOf(remote: URL) {
  const parts = remote.pathname
    .replace(/\.git\/?$/, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts.at(-2)!, name: parts.at(-1)! };
}

const decoded = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/**
 * The Azure DevOps repository a remote is of, its project as `owner`:
 * `dev.azure.com/org/project/_git/repo`, the older
 * `org.visualstudio.com/[DefaultCollection/]project/_git/repo`, or over SSH
 * `ssh.dev.azure.com:v3/org/project/repo`. Without a project in the path the
 * repository is the project's namesake.
 */
export function azureRepoOf(remote: URL): Required<Repo> | null {
  const host = remote.hostname.toLowerCase();
  const parts = remote.pathname
    .replace(/\.git\/?$/, "")
    .split("/")
    .filter(Boolean)
    .map(decoded);
  if (host === "ssh.dev.azure.com" || host === "vs-ssh.visualstudio.com")
    return parts.length === 4 && parts[0] === "v3"
      ? { server: azureServer(parts[1]), owner: parts[2], name: parts[3] }
      : null;
  const path = azureGitPath(host, parts);
  const name =
    path &&
    parts.slice(path.git + 1).find((p) => !/^_(optimized|full)$/.test(p));
  if (!path || !name) return null;
  return { server: path.server, owner: path.project ?? name, name };
}

/**
 * The repository a remote is of when its site says which host serves it:
 * github.com, or an Azure DevOps organization. Gitea's need the account.
 */
export function siteRepoOf(raw: string): Required<Repo> | null {
  const remote = remoteUrl(raw);
  if (!remote) return null;
  if (remote.hostname.toLowerCase() === "github.com") {
    const repo = repoOf(remote);
    return repo && { server: GITHUB_SERVER, ...repo };
  }
  return azureRepoOf(remote);
}

/** Whether `raw` is a remote of `repo` on `server`, whichever host that is. */
export function isRemoteOfRepo(raw: string, server: string, repo: Repo) {
  if (!isAzureServer(server))
    return isRemoteOf(raw, new URL(server).hostname, repo);
  const remote = remoteUrl(raw);
  const found = remote && azureRepoOf(remote);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return (
    !!found &&
    same(found.server, server) &&
    same(found.owner, repo.owner) &&
    same(found.name, repo.name)
  );
}

/** Whether `raw` is a remote of `repo` on `host`; owner and name compare without case. */
export function isRemoteOf(
  raw: string,
  host: string,
  repo: { owner: string; name: string },
) {
  const remote = remoteUrl(raw);
  return (
    !!remote &&
    remoteOnHost(remote, host) &&
    remote.pathname
      .replace(/\.git$/, "")
      .toLowerCase()
      .endsWith(`/${repo.owner}/${repo.name}`.toLowerCase())
  );
}

/** Repository identity without scanning the working tree. */
export async function inspectRepository(
  path: string,
  server: string,
  repo: Repo,
  signal?: AbortSignal,
): Promise<Pick<LocalFolder, "path" | "remoteMatches">> {
  path = await realpath(path);
  const root = await git(path, ["rev-parse", "--show-toplevel"], signal);
  if ((await realpath(root)) !== path)
    throw new Error("Choose the root of the Git repository.");
  const remotes = await git(path, ["remote", "-v"], signal);
  const remoteMatches = remotes
    .split("\n")
    .some((row) => isRemoteOfRepo(row.split(/\s+/)[1] ?? "", server, repo));
  return { path, remoteMatches };
}

export async function inspectFolder(
  path: string,
  server: string,
  repo: Repo,
): Promise<LocalFolder> {
  const local = await inspectRepository(path, server, repo);
  const [head, branch, status] = await Promise.all([
    git(local.path, ["rev-parse", "HEAD"]),
    git(local.path, ["branch", "--show-current"]),
    git(local.path, ["status", "--porcelain"]),
  ]);
  return {
    ...local,
    head,
    branch: branch || "Detached HEAD",
    dirty: !!status,
  };
}
