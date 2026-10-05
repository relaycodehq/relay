import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { inheritedEnv, userShell } from "../terminal/env";
import { terminate } from "../platform/terminate";

/** What a run keeps of the output; npm installs print a lot and only the end says what went wrong. */
const keepChars = 64 * 1024;

export const SETUP_TIMEOUT_MS = 15 * 60_000;
export const TEARDOWN_TIMEOUT_MS = 2 * 60_000;

export interface WorktreeEnv {
  /** The worktree's folder. */
  path: string;
  /** The project's checkout, for linking or copying from it. */
  root: string;
  branch?: string;
  portOffset: number;
}

/** What a worktree's processes are told about where they run. */
export const worktreeVars = (
  worktree: WorktreeEnv,
): Record<string, string> => ({
  RELAY_PORT_OFFSET: String(worktree.portOffset),
  RELAY_WORKTREE: worktree.path,
  RELAY_PROJECT_ROOT: worktree.root,
  ...(worktree.branch ? { RELAY_BRANCH: worktree.branch } : {}),
});

export interface CommandRun {
  output: string;
  exitCode?: number;
  stopped?: "timeout" | "cancelled";
}

/**
 * Runs a project's setup or teardown command in its worktree with the
 * user's login shell, as their terminal would. `onOutput` gets the kept tail
 * as it grows. Never rejects: a command that can't start fails like one that
 * exits non-zero.
 */
export function runWorktreeCommand(
  command: string,
  worktree: WorktreeEnv,
  {
    timeoutMs,
    signal,
    onOutput,
  }: {
    timeoutMs: number;
    signal?: AbortSignal;
    onOutput?: (output: string) => void;
  },
): Promise<CommandRun> {
  return new Promise((resolve) => {
    let output = "";
    let stopped: CommandRun["stopped"];
    const env = {
      ...inheritedEnv(),
      ...worktreeVars(worktree),
      // The output lands in a thread, not a terminal.
      NO_COLOR: "1",
    };
    const [shell] = userShell();
    const child =
      process.platform === "win32"
        ? spawn(command, {
            cwd: worktree.path,
            env,
            shell: true,
            windowsHide: true,
          })
        : spawn(shell, ["-lc", command], {
            cwd: worktree.path,
            env,
            // Its own process group, so stopping it stops what it started.
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
    const add = (chunk: Buffer | string) => {
      output = (output + stripVTControlCharacters(String(chunk))).slice(
        -keepChars,
      );
      onOutput?.(output);
    };
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    const stop = (why: NonNullable<CommandRun["stopped"]>) => {
      stopped ??= why;
      terminate(child, { group: true });
    };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const abort = () => stop("cancelled");
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    let done = false;
    const finish = (run: CommandRun) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(run);
    };
    child.on("error", (e) => {
      add(`${e.message}\n`);
      finish({ output, exitCode: -1 });
    });
    child.on("exit", (code) => {
      const end = () =>
        finish({
          output,
          ...(stopped ? { stopped } : { exitCode: code ?? -1 }),
        });
      // Output still on its way arrives before `close`, unless something it
      // left running in the background holds the pipes open.
      child.once("close", end);
      setTimeout(end, 500).unref();
    });
  });
}
