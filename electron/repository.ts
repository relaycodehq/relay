import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import type { LocalFolder, Repo } from "../shared/types";
const exec = promisify(execFile);
const git = async (path: string, args: string[], signal?: AbortSignal) =>
  (
    await exec("git", ["-C", path, ...args], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      signal,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
    })
  ).stdout.trim();

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
    const raw = row.split(/\s+/)[1] ?? "";
    try {
      const normalized = raw.includes("://")
        ? new URL(raw)
        : new URL(raw.replace(/^([^@]+@)?([^:]+):/, "ssh://$2/"));
      return (
        normalized.hostname === host &&
        normalized.pathname
          .replace(/\.git$/, "")
          .toLowerCase()
          .endsWith(`/${suffix}`)
      );
    } catch {
      return false;
    }
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
