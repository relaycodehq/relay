import { realpath } from "node:fs/promises";
import type { LocalFolder, Repo } from "../../shared/types";
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
  const host = new URL(server).hostname;
  const remoteMatches = remotes
    .split("\n")
    .some((row) => isRemoteOf(row.split(/\s+/)[1] ?? "", host, repo));
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
