import { stopProcessTree } from "../platform/terminate";
import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, dirname } from "node:path";
import { promisify } from "node:util";
import { NotText, textLimit, tooLarge } from "./working-files";
import { findGit } from "../platform/executables";
import { gitMissing, type GitInfo } from "../../shared/working-tree";
const exec = promisify(execFile);
const missing = `${gitMissing} Install Git, or choose where it is in Settings → Integrations.`;
/** The Git chosen in Settings; unset, Relay finds its own. */
let chosen: string | null = null;
let found: Promise<string> | undefined;
/**
 * The executable once found, so a call starts Git before it returns, as a
 * bare `execFile("git")` did: a snapshot taken then can't miss what comes next.
 */
let resolved: string | undefined;
export function setGitPath(path: string | null) {
  chosen = path;
  found = resolved = undefined;
}
/** The Git executable to run: the chosen one, else one on PATH or in a usual install folder. */
export function gitExecutable(): Promise<string> {
  if (found) return found;
  const current = (found = lookUpGit());
  // A failure isn't kept, so installing Git works without a restart.
  current.then(
    (git) => {
      if (found === current) resolved = git;
    },
    () => {
      if (found === current) found = undefined;
    },
  );
  return current;
}
async function lookUpGit() {
  const path = chosen;
  if (path) {
    await access(path).catch(() => {
      throw new Error(
        `${gitMissing} The Git chosen in Settings is gone: ${path}`,
      );
    });
  }
  const git =
    path ??
    (await findGit().catch(() => {
      throw new Error(missing);
    }));
  // Agents and terminals run Git too, and a PATH from before Git was
  // installed (Windows keeps the one the app started with) lacks it.
  const dir = dirname(git),
    paths = (process.env.PATH ?? "").split(delimiter);
  if (!paths.includes(dir))
    process.env.PATH = [dir, ...paths].filter(Boolean).join(delimiter);
  return git;
}
/** Git's version line; fails when `path` isn't Git. */
export async function gitVersion(path: string) {
  let stdout: string;
  try {
    // Windows refuses a file that isn't a program before any promise exists.
    ({ stdout } = await exec(path, ["--version"], {
      timeout: 15000,
      encoding: "utf8",
      env: gitEnv(),
    }));
  } catch {
    throw new Error("That program didn’t run as Git.");
  }
  const version = stdout.trim();
  if (!version.startsWith("git version"))
    throw new Error("That program isn’t Git.");
  return version;
}
export async function gitInfo(): Promise<GitInfo> {
  try {
    const path = await gitExecutable();
    return {
      path,
      chosen: !!chosen,
      version: await gitVersion(path),
      error: null,
    };
  } catch (e) {
    return {
      path: chosen,
      chosen: !!chosen,
      version: null,
      error: (e as Error).message,
    };
  }
}
/** Git never prompts, takes optional locks, or reads paths as patterns. */
export const gitEnv = (extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_LITERAL_PATHSPECS: "1",
  GCM_INTERACTIVE: "never",
  ...extra,
});
/** Git may include credential-bearing remote URLs in output and failures. */
export const redactCredentials = (text: string) =>
  // A token often stands alone in the user name.
  text.replace(/(https?:\/\/)[^\s/@]+@/g, "$1[redacted]@");
export interface GitOptions {
  /** Milliseconds; 15 s unless set. */
  timeout?: number;
  maxBuffer?: number;
  /** Added over `gitEnv`. */
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}
/** Git's failure as the user should see it: its own message, no credentials. */
export function gitError(e: unknown) {
  const error = e as Error & { stderr?: string | Buffer; code?: unknown };
  // The executable went away since it was found; find it again next time.
  if (error.code === "ENOENT") {
    found = resolved = undefined;
    return new Error(missing);
  }
  return new Error(
    redactCredentials(String(error.stderr || "") || error.message).slice(
      0,
      3000,
    ),
  );
}
/** Runs Git in `root`; a timeout as a number is the common case. */
export async function git(
  root: string,
  args: string[],
  options: number | GitOptions = {},
): Promise<string> {
  const {
    timeout = 15000,
    maxBuffer = 16 * 1024 * 1024,
    env,
    signal,
  } = typeof options === "number" ? { timeout: options } : options;
  const file = resolved ?? (await gitExecutable());
  signal?.throwIfAborted();
  if (signal)
    return cancellableGit(file, root, args, {
      timeout,
      maxBuffer,
      env,
      signal,
    });
  try {
    return (
      await exec(file, ["-C", root, ...args], {
        timeout,
        maxBuffer,
        env: gitEnv(env),
        encoding: "utf8",
      })
    ).stdout;
  } catch (error) {
    throw gitError(error);
  }
}

/** Keep pipes open until the entire cancelled Git command has stopped. */
function cancellableGit(
  file: string,
  root: string,
  args: string[],
  options: Required<Pick<GitOptions, "timeout" | "maxBuffer" | "signal">> &
    Pick<GitOptions, "env">,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { signal, timeout, maxBuffer } = options;
    const child = spawn(file, ["-C", root, ...args], {
      env: gitEnv(options.env),
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stopping: Promise<void> | undefined;
    let failure: Error | undefined;
    const stop = () => {
      stopping ??= stopProcessTree(child).catch((error) => {
        failure = error;
      });
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    const timer = timeout
      ? setTimeout(() => {
          failure = new Error("Git timed out.");
          stop();
        }, timeout)
      : undefined;
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let outBytes = 0,
      errBytes = 0;
    const collect = (chunk: Buffer, output: boolean) => {
      if (output) outBytes += chunk.length;
      else errBytes += chunk.length;
      if ((output ? outBytes : errBytes) > maxBuffer) {
        failure = new Error("Git output exceeded the buffer limit.");
        stop();
      } else (output ? stdout : stderr).push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", async (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      await stopping;
      if (signal.aborted) return reject(new Error("Cancelled."));
      if (failure) return reject(gitError(failure));
      if (code !== 0)
        return reject(
          gitError({
            message: `Git exited with ${code}.`,
            stderr: Buffer.concat(stderr).toString(),
          }),
        );
      resolve(Buffer.concat(stdout).toString());
    });
  });
}

/** The checked-out branch; empty when HEAD is detached. */
/** Paths with unresolved conflicts, as they are on disk rather than C-quoted. */
export async function conflictedFiles(root: string) {
  const out = await git(root, [
    "diff",
    "--name-only",
    "--diff-filter=U",
    "-z",
  ]).catch(() => "");
  return out.split("\0").filter(Boolean);
}
export async function currentBranch(root: string) {
  return (await git(root, ["branch", "--show-current"])).trim();
}
/** The checked-out branch, or null when detached or Git can't say. */
export const currentBranchOrNull = (root: string) =>
  currentBranch(root).then(
    (name) => name || null,
    () => null,
  );
/** The checked-out branch, none when detached, or `known` when Git can't say. */
export const currentBranchOr = (root: string, known: string | undefined) =>
  currentBranch(root).then(
    (name) => name || undefined,
    () => known,
  );
/** Git's output as bytes, up to `limit`; past it, the content isn't text Relay shows. */
export async function gitBytes(
  root: string,
  args: string[],
  limit = textLimit,
) {
  const file = resolved ?? (await gitExecutable());
  try {
    return (
      await exec(file, ["-C", root, ...args], {
        timeout: 15000,
        maxBuffer: limit + 4096,
        encoding: "buffer",
        env: gitEnv(),
      })
    ).stdout;
  } catch (e) {
    // The buffer stops just past the limit.
    if (
      (e as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    )
      throw new NotText(tooLarge);
    throw gitError(e);
  }
}
