import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  sourceControlKinds,
  type SourceControlKind,
} from "../../shared/source-control";
import {
  findExecutable,
  linkedTool,
  runExecutable,
  setLinkedTools,
} from "../executables";
import type { Store } from "../store";

export const probeTimeout = 8000;

/** Without the colours `tea` prints even into a pipe. */
export const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

interface Cli {
  program: string;
  /** As users know it, for "that doesn't look like …". */
  name: string;
  versionArgs: string[];
  /** The version in what `versionArgs` printed; none when it isn't this CLI. */
  version: (stdout: string) => string | undefined;
}

/** The command-line tool each host is reached through. */
export const clis: Record<SourceControlKind, Cli> = {
  github: {
    program: "gh",
    name: "the GitHub CLI",
    versionArgs: ["--version"],
    version: (out) => /^gh version (\S+)/m.exec(out)?.[1],
  },
  gitea: {
    program: "tea",
    name: "tea",
    versionArgs: ["--version"],
    version: (out) => /^Version: (\S+)/m.exec(plain(out))?.[1],
  },
  "azure-devops": {
    program: "az",
    name: "the Azure CLI",
    // `az --version` also asks PyPI for updates, which takes seconds.
    versionArgs: ["version", "--output", "json"],
    version: (out) => {
      try {
        const version = JSON.parse(out)["azure-cli"];
        return typeof version === "string" ? version : undefined;
      } catch {
        return undefined;
      }
    },
  },
};

/** A host's CLI as Relay finds it; each part absent when it isn't known. */
export interface CliState {
  path?: string;
  linked?: boolean;
  version?: string;
  /** Why it can't be used: a linked program is gone, or it isn't the CLI. */
  error?: string;
}

export async function probeCli(kind: SourceControlKind): Promise<CliState> {
  const cli = clis[kind];
  const linked = linkedTool(cli.program) ? { linked: true } : {};
  let path: string;
  try {
    path = await findExecutable(cli.program);
  } catch (error) {
    return linked.linked ? { ...linked, error: (error as Error).message } : {};
  }
  const run = await runExecutable(path, cli.versionArgs, probeTimeout);
  const version = run.code === 0 ? cli.version(run.stdout) : undefined;
  return version
    ? { path, ...linked, version }
    : {
        path,
        ...linked,
        error: run.timedOut
          ? `${cli.program} didn't say its version in time.`
          : `That program doesn't say which version of ${cli.program} it is.`,
      };
}

/** The parts of a `CliState` a host reports, leaving out what isn't known. */
export const cliFields = ({ path, linked, version }: CliState) => ({
  ...(path ? { path } : {}),
  ...(linked ? { linked } : {}),
  ...(version ? { version } : {}),
});

/**
 * The program a typed or chosen path names: `~` is the home folder, and a
 * folder means the program inside it, e.g. `/opt/homebrew/bin` for its `gh`.
 */
export async function resolveCliPath(program: string, typed: string) {
  let path = typed.trim().replace(/^~(?=$|[\\/])/, homedir());
  if (!isAbsolute(path))
    throw new Error(
      `Give the full path to ${program}, e.g. /usr/local/bin/${program}.`,
    );
  const found = await stat(path).catch(() => null);
  if (!found) throw new Error(`There's nothing at ${path}.`);
  if (found.isDirectory()) {
    path = join(path, program + (process.platform === "win32" ? ".exe" : ""));
    if (!(await stat(path).catch(() => null)))
      throw new Error(`That folder has no ${program} in it.`);
  }
  return path;
}

/** Links the program at `typed` as a host's CLI if it says it is that CLI. */
export async function linkCli(
  store: Store,
  kind: SourceControlKind,
  typed: string,
) {
  const cli = clis[kind];
  const path = await resolveCliPath(cli.program, typed);
  const run = await runExecutable(path, cli.versionArgs, 15_000);
  if (run.code !== 0 || !cli.version(run.stdout))
    throw new Error(
      `That doesn't look like ${cli.name}: it didn't say which version it is.${run.output.trim() ? `\n${plain(run.output).trim().slice(-300)}` : ""}`,
    );
  await relink(store, kind, path);
}

/** Forgets a linked CLI; Relay then searches again. */
export const unlinkCli = (store: Store, kind: SourceControlKind) =>
  relink(store, kind, undefined);

async function relink(store: Store, kind: SourceControlKind, path?: string) {
  await store.update((s) => {
    const paths = { ...s.sourceControl?.paths };
    if (path) paths[kind] = path;
    else delete paths[kind];
    s.sourceControl = { ...s.sourceControl, paths };
  });
  applyLinkedTools(store);
}

/** Hands the linked CLIs to the executable lookup, by program name. */
export function applyLinkedTools(store: Store) {
  const paths = store.get().sourceControl?.paths ?? {};
  setLinkedTools(
    Object.fromEntries(
      sourceControlKinds.flatMap((kind) =>
        paths[kind] ? [[clis[kind].program, paths[kind]]] : [],
      ),
    ),
  );
}
