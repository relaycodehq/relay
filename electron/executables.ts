import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, delimiter, dirname, extname } from "node:path";
import { homedir } from "node:os";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { pathReady } from "./shell-path";
import { agentProviders, type AgentProvider } from "../shared/agents";
import { parseVersion } from "../shared/agent-updates";

const windows = process.platform === "win32";

function miseData() {
  return (
    process.env.MISE_DATA_DIR ||
    (windows && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "mise")
      : join(homedir(), ".local/share/mise"))
  );
}

/**
 * Mise keeps each tool in `installs/<tool>/<version>`, `latest` linking the
 * newest, and only puts those on PATH inside an activated interactive shell.
 * The tool's folder is named for its backend too (`aqua-anomalyco-opencode`).
 */
async function miseDirs(name: string) {
  const installs = join(miseData(), "installs");
  const tools = await readdir(installs).catch(() => [] as string[]);
  return tools
    .filter((tool) => tool === name || tool.endsWith(`-${name}`))
    .flatMap((tool) => [
      join(installs, tool, "latest"),
      join(installs, tool, "latest", "bin"),
    ]);
}

function searchPaths() {
  const home = homedir();
  return [
    ...(process.env.PATH ?? "").split(delimiter),
    join(home, ".bun/bin"),
    join(home, ".local/bin"),
    join(home, ".opencode/bin"),
    join(home, ".claude/local"),
    join(home, ".npm-global/bin"),
    join(home, ".volta/bin"),
    join(home, ".cargo/bin"),
    join(home, ".yarn/bin"),
    join(home, ".local/share/pnpm"),
    join(home, ".asdf/shims"),
    ...(windows
      ? [
          process.env.APPDATA && join(process.env.APPDATA, "npm"),
          process.env.LOCALAPPDATA &&
            join(process.env.LOCALAPPDATA, "Programs", "Git", "cmd"),
          process.env.ProgramFiles &&
            join(process.env.ProgramFiles, "Git", "cmd"),
          process.env.ProgramFiles && join(process.env.ProgramFiles, "nodejs"),
        ]
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/home/linuxbrew/.linuxbrew/bin",
          "/snap/bin",
          join(home, ".nix-profile/bin"),
        ]),
  ].filter((dir): dir is string => !!dir);
}

/**
 * npm installs Windows commands as `.cmd` shims, which Node cannot spawn
 * without a shell. Use the shim's real target instead: a native `.exe`, or a
 * JavaScript entry that `spawnExecutable` runs with Node.
 */
async function unwrapShim(path: string) {
  const text = await readFile(path, "utf8").catch(() => "");
  const target = /"%~?dp0%?\\([^"%]+\.(?:exe|js|cjs|mjs))"/i.exec(text)?.[1];
  return target ? join(dirname(path), target) : path;
}

export const findExecutable = (name: string) => locate(name);

/**
 * Which install a path from `findExecutable` runs: its file and when that was
 * last written. Updating a CLI rewrites it or points its link at another version.
 */
export async function installStamp(found: string) {
  const path = await realpath(found);
  const { mtimeMs, size } = await stat(path);
  return `${path}\0${mtimeMs}\0${size}`;
}

/** Git's own lookup, apart from the agent CLIs `findExecutable` finds. */
export const findGit = () => locate("git");

const isAgent = (name: string): name is AgentProvider =>
  (agentProviders as readonly string[]).includes(name);

/** The CLIs the user linked in Settings, ahead of any search. */
let linked: Partial<Record<AgentProvider, string>> = {};
/** The candidate that last answered `--version`, so a lookup doesn't run each again. */
let answered = new Map<string, { path: string; until: number }>();
const verifiedFor = 10 * 60_000;
/** A search where none answered is not repeated for a moment: each try can take seconds. */
const unverifiedFor = 60_000;
const versionTimeout = 5000;

export function setLinkedAgents(paths: Partial<Record<AgentProvider, string>>) {
  linked = { ...paths };
  answered = new Map();
}

export const linkedAgent = (provider: AgentProvider) => linked[provider];

/** Every program called `name` in the places the CLIs usually live, in the order to try them. */
async function* candidates(name: string) {
  await pathReady();
  const extensions = windows ? [".exe", ".cmd", ".bat", ""] : [""];
  // Mise's installs come after the rest, so an activated shell's own choice
  // wins, but ahead of its shims, which need mise itself to run.
  const dirs = [
    ...searchPaths(),
    ...(isAgent(name) ? await miseDirs(name) : []),
    join(miseData(), "shims"),
  ];
  const seen = new Set<string>();
  for (const dir of dirs) {
    for (const extension of extensions) {
      const full = join(dir, name + extension);
      try {
        await access(full, windows ? constants.F_OK : constants.X_OK);
      } catch {
        continue;
      }
      let path = full;
      if (windows && extension !== ".exe") {
        if (extension === "") continue;
        path = await unwrapShim(full);
        if (path === full) continue;
      }
      if (seen.has(path)) continue;
      seen.add(path);
      yield path;
    }
  }
}

async function locate(name: string) {
  const chosen = isAgent(name) ? linked[name] : undefined;
  if (chosen) {
    await access(chosen).catch(() => {
      throw new Error(`The ${name} you linked in Settings is gone: ${chosen}`);
    });
    return chosen;
  }
  const found: string[] = [];
  for await (const path of candidates(name)) {
    if (!isAgent(name)) return path;
    found.push(path);
  }
  if (!found.length)
    throw new Error(
      `${name} was not found. Install it and make sure it is on PATH.`,
    );
  return answering(name, found);
}

/**
 * The first of `found` that says its version. The first on PATH can be a
 * shim or leftover that runs nowhere near the real CLI; the search shouldn't
 * stop there. Where none answers, the first is used all the same.
 */
async function answering(name: string, found: string[]) {
  const known = answered.get(name);
  if (known && known.until > Date.now() && found.includes(known.path))
    return known.path;
  for (const path of found) {
    if (await saysVersion(path)) {
      answered.set(name, { path, until: Date.now() + verifiedFor });
      return path;
    }
  }
  answered.set(name, { path: found[0], until: Date.now() + unverifiedFor });
  return found[0];
}

/** Whether running `path --version` prints a version. */
async function saysVersion(path: string) {
  const run = await runExecutable(path, ["--version"], versionTimeout);
  return run.code === 0 && !!parseVersion(run.stdout);
}

/** The command line for a path from `findExecutable`: JavaScript entries run with Node. */
export function executableCommand(file: string, args: readonly string[]) {
  return /^\.[cm]?js$/i.test(extname(file))
    ? { command: "node", args: [file, ...args] }
    : { command: file, args: [...args] };
}

/** Runs a path from `findExecutable`, starting JavaScript entries with Node. */
export const spawnExecutable = ((
  file: string,
  args: readonly string[],
  options: object,
) => {
  const line = executableCommand(file, args);
  return spawn(line.command, line.args, options);
}) as typeof spawn;

export interface Exec {
  code: number | null;
  stdout: string;
  /** The end of stdout and stderr together, for showing a failure. */
  output: string;
  timedOut: boolean;
}

const outputLimit = 10_000;

/** Runs a path from `findExecutable` and collects what it says; never rejects. */
export const runExecutable = (
  file: string,
  args: string[],
  timeout: number,
): Promise<Exec> =>
  new Promise((resolve) => {
    let stdout = "",
      output = "",
      timedOut = false;
    const child = spawnExecutable(file, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    const collect = (chunk: Buffer, isStdout: boolean) => {
      const text = chunk.toString();
      if (isStdout && stdout.length < 1_000_000) stdout += text;
      output = (output + text).slice(-outputLimit);
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr?.on("data", (chunk: Buffer) => collect(chunk, false));
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, output: error.message, timedOut });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, output, timedOut });
    });
  });
