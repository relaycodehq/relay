import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  FolderEntry,
  FolderInfo,
  LinkedFolder,
  LinkSuggestion,
  Project,
} from "../../shared/projects";
import { linkName } from "../../shared/projects";
import { repositoryRoot } from "./projects";

/** `~/work` → `/Users/you/work`. */
export const expandHome = (path: string) =>
  path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;

const isRepository = (dir: string) =>
  lstat(join(dir, ".git")).then(
    () => true,
    () => false,
  );

/** What a folder picked or typed turns out to be. */
export async function inspectFolder(path: string): Promise<FolderInfo> {
  const typed = expandHome(path.trim());
  const real = await realpath(typed).catch(() => null);
  if (!real) return { path: typed, kind: "missing" };
  if (!(await stat(real)).isDirectory()) return { path: real, kind: "file" };
  const root = await repositoryRoot(real);
  if (!root) return { path: real, kind: "plain" };
  return root === real
    ? { path: real, kind: "repository" }
    : { path: real, kind: "inside", root };
}

/** The folders in `dir`, hidden ones aside, for typing a path. */
export async function listFolders(dir: string): Promise<FolderEntry[]> {
  const real = await realpath(expandHome(dir));
  const entries = await readdir(real, { withFileTypes: true });
  const folders = entries
    .filter((e) => !e.name.startsWith(".") && e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 300);
  return Promise.all(
    folders.map(async (name) => ({
      name,
      path: join(real, name),
      repository: await isRepository(join(real, name)),
    })),
  );
}

/** Repositories beside `path` in its parent folder, like a backend next to its frontend. */
export async function siblingRepositories(path: string) {
  const parent = dirname(path);
  const entries = await listFolders(parent).catch(() => []);
  return entries.filter((e) => e.repository && e.path !== path);
}

/** Throws for a newly linked folder that isn't there; ones linked before may have gone since. */
export async function checkNewLinks(
  links: readonly LinkedFolder[] | undefined,
  before: readonly LinkedFolder[] | undefined,
) {
  const known = new Set((before ?? []).map((l) => l.path));
  for (const link of links ?? []) {
    if (known.has(link.path)) continue;
    const info = await inspectFolder(link.path);
    if (info.kind === "missing")
      throw new Error(`${linkName(link.path)} isn't there.`);
    if (info.kind === "file")
      throw new Error(`${linkName(link.path)} is a file, not a folder.`);
  }
}

/** Folders worth linking to `project`: repositories beside it, Relay projects first, then the other projects. */
export async function linkSuggestions(
  project: Project,
  projects: readonly Project[],
): Promise<LinkSuggestion[]> {
  const others = projects.filter(
    (p) => p.id !== project.id && !p.scratch && !p.removed,
  );
  const named = (path: string) => others.find((p) => p.path === path)?.name;
  const beside = (await siblingRepositories(project.path)).map((f) => ({
    path: f.path,
    project: named(f.path),
    repository: true,
    beside: true,
  }));
  beside.sort((a, b) => Number(!a.project) - Number(!b.project));
  const elsewhere = others
    .filter((p) => !beside.some((f) => f.path === p.path))
    .map((p) => ({
      path: p.path,
      project: p.name,
      repository: !p.plain,
      beside: false,
    }));
  return [...beside, ...elsewhere];
}
