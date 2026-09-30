// Adapted from T3 Code's packages/shared/src/shell.ts and apps/server/src/os-jank.ts (MIT).
import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { delimiter } from "node:path";
import { promisify } from "node:util";

/** Runs a program and resolves with its stdout; rejects on failure or timeout. */
export type Run = (file: string, args: string[]) => Promise<string>;

const START = "__RELAY_PATH_START__";
const END = "__RELAY_PATH_END__";
const SHELL_TIMEOUT = 5000;

const run: Run = async (file, args) =>
  (
    await promisify(execFile)(file, args, {
      encoding: "utf8",
      timeout: SHELL_TIMEOUT,
    })
  ).stdout;

/**
 * Started with the launch PATH, the shell hands it back reordered: macOS's
 * path_helper puts the system folders first and the inherited ones after, so
 * `mergePath` could no longer tell which folders the launch put in front. A
 * bare PATH leaves only what the profile adds.
 */
const runShell: Run = async (file, args) =>
  (
    await promisify(execFile)(file, args, {
      encoding: "utf8",
      timeout: SHELL_TIMEOUT,
      env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    })
  ).stdout;

/** The shells worth asking, the user's own first. */
export function loginShells(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  userShell?: string,
): string[] {
  const fallback = platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  const shells = [env.SHELL, userShell, fallback]
    .map((shell) => shell?.trim())
    .filter((shell): shell is string => !!shell);
  return [...new Set(shells)];
}

/** The PATH between the markers, whatever else the profile printed around them. */
export function extractPath(output: string): string | undefined {
  const start = output.indexOf(START);
  if (start === -1) return undefined;
  const from = start + START.length;
  const end = output.indexOf(END, from);
  if (end === -1) return undefined;
  const value = output
    .slice(from, end)
    .replace(/^\r?\n/, "")
    .replace(/\r?\n$/, "");
  return value || undefined;
}

/**
 * The order the user's own terminal finds programs in, so Relay runs the
 * `gh`, `git` or agent CLI that `which` names first. Folders put in front of
 * the launch PATH keep their place: a test's fake CLIs, or
 * `PATH=/x:$PATH relay`. Then the shell's order, then what only the launch
 * had. A launcher's bare `/usr/bin` would otherwise beat the mise or Homebrew
 * install the shell puts first.
 */
export function mergePath(
  inherited: string | undefined,
  shell: string | undefined,
  separator = delimiter,
): string | undefined {
  const split = (value: string | undefined) =>
    (value?.split(separator) ?? []).map((raw) => raw.trim()).filter(Boolean);
  const launch = split(inherited),
    fromShell = split(shell);
  const known = new Set(fromShell);
  const shared = launch.findIndex((entry) => known.has(entry));
  const front = shared === -1 ? launch : launch.slice(0, shared);
  const entries = [...new Set([...front, ...fromShell, ...launch])];
  return entries.length ? entries.join(separator) : undefined;
}

async function readLoginShellPath(shell: string, exec: Run = runShell) {
  const script = `printf '%s\\n' '${START}'; printenv PATH || true; printf '%s\\n' '${END}'`;
  return extractPath(await exec(shell, ["-ilc", script]));
}

async function readLaunchctlPath(exec: Run = run) {
  return (await exec("/bin/launchctl", ["getenv", "PATH"])).trim() || undefined;
}

/**
 * Apps started from the Dock or a launcher inherit a bare PATH without the
 * user's tools; a login shell reads the profile that sets the real one.
 * Merges that PATH into `env` as `mergePath` orders them.
 */
export async function hydratePath(
  env: NodeJS.ProcessEnv,
  options: { platform?: NodeJS.Platform; userShell?: string; exec?: Run } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return;
  let shellPath: string | undefined;
  const shells = loginShells(
    env,
    platform,
    options.userShell ?? accountShell(),
  );
  for (const shell of shells) {
    shellPath = await readLoginShellPath(shell, options.exec).catch(
      () => undefined,
    );
    if (shellPath) break;
  }
  if (!shellPath && platform === "darwin")
    shellPath = await readLaunchctlPath(options.exec).catch(() => undefined);
  const merged = mergePath(env.PATH, shellPath);
  if (merged) env.PATH = merged;
}

function accountShell() {
  try {
    return userInfo().shell ?? undefined;
  } catch {
    return undefined;
  }
}

let hydration: Promise<void> | undefined;
/** Fills the process PATH once; executable lookups wait for it. */
export function pathReady(): Promise<void> {
  return (hydration ??= hydratePath(process.env).catch(() => {}));
}
