import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { recheckedPerRoot } from "./rechecked-per-root";

const exec = promisify(execFile);

/**
 * Reads that refresh the index, and so run the repository's `core.fsmonitor`.
 * Relay polls these, and a folder someone handed over brings its own
 * `.git/config`, so a hook command named there would run on every poll.
 */
const indexReads = new Set([
  "status",
  "diff",
  "diff-index",
  "diff-files",
  "ls-files",
  "check-ignore",
  "grep",
  "blame",
]);

const monitorOff = ["-c", "core.fsmonitor=false"];

/** The Git subcommand in `args`, past any `-c key=value` settings. */
function subcommandOf(args: string[]) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-c") i++;
    else if (!args[i].startsWith("-")) return args[i];
  }
}

/** Whether `args` is a read that refreshes the index, the kind Relay polls. */
export const refreshesIndex = (args: string[]) =>
  indexReads.has(subcommandOf(args) ?? "");

/**
 * Whether `root`'s `core.fsmonitor` names a hook command. Git's builtin
 * daemon is a boolean (`true`) and stays on: it's safe, and what keeps
 * status fast in big repositories. Unset exits 1; a value that isn't a
 * boolean fails, so it is a command.
 */
const monitorChecks = recheckedPerRoot((file, root, env) =>
  exec(file, ["-C", root, "config", "--type=bool", "--get", "core.fsmonitor"], {
    env,
    timeout: 15000,
  }).then(
    () => false,
    (error: { code?: unknown }) => error.code !== 1,
  ),
);

/** Whether `root`'s fsmonitor is a hook, asked again once the last answer is a minute old. */
export const checkMonitor = (
  file: string,
  root: string,
  env: NodeJS.ProcessEnv,
) => monitorChecks(file, root, env).done;

/**
 * The `-c` settings that keep a read from running the repository's fsmonitor
 * hook. Decided without waiting, so Git still starts before `git()` returns:
 * until the check has answered, a read goes without fsmonitor at all.
 * Commands the person asked for (commit, checkout) keep the repository's
 * own, unless Relay runs one as a `polled` look of its own.
 */
export function monitorOverride(
  file: string,
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  polled = false,
): string[] {
  if (!polled && !refreshesIndex(args)) return [];
  const hook = monitorChecks(file, root, env).value ?? true;
  return hook ? monitorOff : [];
}
