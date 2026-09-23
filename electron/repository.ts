import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import type { LocalFolder, Repo } from "../shared/types";
import { gitEnv } from "./git";
const exec = promisify(execFile);
const git = async (path: string, args: string[], signal?: AbortSignal) =>
  (
    await exec("git", ["-C", path, ...args], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      signal,
      env: gitEnv(),
    })
  ).stdout.trim();
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
  const suffix = `${repo.owner}/${repo.name}`.toLowerCase();
  const remoteMatches = remotes.split("\n").some((row) => {
    const remote = remoteUrl(row.split(/\s+/)[1] ?? "");
    return (
      remote?.hostname === host &&
      remote.pathname
        .replace(/\.git$/, "")
        .toLowerCase()
        .endsWith(`/${suffix}`)
    );
  });
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
