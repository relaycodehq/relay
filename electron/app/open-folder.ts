// A folder handed to Relay (`relay .`, or dropped on its Dock icon) opens as
// a project: the one it's in, or a new one for its Git repository.
import { statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import type { Project } from "../../shared/projects/project";

/**
 * Words `relay` takes as commands, even where a folder has the same name;
 * any other word naming a folder opens it.
 */
export const relayCommands = [
  "help",
  "run",
  "start",
  "stop",
  "restart",
  "status",
  "pair",
  "logs",
  "projects",
  "project",
  "threads",
  "devices",
  "device",
  "service",
  "setup",
  "version",
  "update",
  "settings",
  "config",
  "call",
] as const;

/**
 * The folder among a launch's arguments: the first that names a directory,
 * skipping Chromium's switches and links like relay-room:.
 */
export function launchFolder(args: readonly string[], cwd: string) {
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    // A scheme, but not a Windows drive letter.
    if (/^[a-z][\w+.-]+:/i.test(arg)) continue;
    const folder = resolve(cwd, arg);
    try {
      if (statSync(folder).isDirectory()) return folder;
    } catch {}
  }
  return undefined;
}

export interface FolderProjects {
  list(): Promise<Project[]>;
  /** Adds the root of a Git repository, or a plain folder; an existing one comes back. */
  add(folder: string): Promise<Project>;
  repositoryRoot(dir: string): Promise<string | null>;
}

const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
};

/** The project `folder` opens: the innermost one holding it, else its repository added as one. */
export async function projectForFolder(
  folder: string,
  projects: FolderProjects,
  home = homedir(),
): Promise<{ project: Project } | { refused: string }> {
  const real = await realpath(folder).catch(() => undefined);
  if (!real) return { refused: `There's no folder at ${folder}.` };
  const holders = (await projects.list())
    .filter((p) => !p.scratch && within(p.path, real))
    .sort((a, b) => b.path.length - a.path.length);
  if (holders[0]) return { project: holders[0] };
  const root = (await projects.repositoryRoot(real)) ?? real;
  if (root === parse(root).root)
    return { refused: "That's the whole disk; open a folder inside it." };
  const realHome = await realpath(home).catch(() => home);
  if (within(root, realHome))
    return {
      refused: "That's your home folder; open a project folder inside it.",
    };
  return { project: await projects.add(root) };
}
