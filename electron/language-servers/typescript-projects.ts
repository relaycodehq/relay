import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { parse } from "jsonc-parser";

type Config = Record<string, any>;

/** Which files a tsconfig claims, as paths inside the folder with forward slashes. */
interface Claims {
  files?: string[];
  include: string[];
  exclude: string[];
}

const SOURCE = /(?<!\.d)\.[cm]?tsx?$/;
const MAX_LOOKED_AT = 5000;
const MAX_CONFIGS = 40;

/**
 * One file from each project a solution-style tsconfig.json at `root`
 * lists, as paths inside `root`. tsserver loads a project only once a file
 * of its opens, and gives a file to the first listed project claiming it,
 * so each pick is a file no earlier project claims. Empty when the folder's
 * tsconfig.json isn't a list of projects.
 */
export async function oneFilePerProject(root: string): Promise<string[]> {
  const configs = await listedProjects(root, join(root, "tsconfig.json"));
  const claims = await Promise.all(
    configs.map((config) => claimsOf(root, config)),
  );
  const picks: string[] = [];
  for (const [index, own] of claims.entries()) {
    const earlier = claims.slice(0, index);
    const pick = await firstFileOnlyClaimedBy(root, own, earlier);
    if (pick) picks.push(pick);
  }
  return picks;
}

/** The projects a solution config lists, solutions within it opened up; none when it isn't one. */
async function listedProjects(
  root: string,
  file: string,
  seen = new Set<string>(),
) {
  const config = await readConfig(file);
  if (!config || !isSolution(config) || seen.size >= MAX_CONFIGS) return [];
  seen.add(file);
  const projects: string[] = [];
  for (const ref of config.references) {
    if (typeof ref?.path !== "string") continue;
    let path = resolve(dirname(file), ref.path);
    if (!path.endsWith(".json")) path = join(path, "tsconfig.json");
    if (seen.has(path) || relative(root, path).startsWith("..")) continue;
    const referenced = await readConfig(path);
    if (!referenced) continue;
    if (isSolution(referenced))
      projects.push(...(await listedProjects(root, path, seen)));
    else projects.push(path);
  }
  return projects;
}

/** Lists other projects and checks nothing of its own, like `files: []` with `references`. */
function isSolution(config: Config) {
  const noFiles = Array.isArray(config.files) && config.files.length === 0;
  return (
    noFiles &&
    !config.include &&
    Array.isArray(config.references) &&
    config.references.length > 0
  );
}

/** What `file` claims, `files`, `include` and `exclude` taken from what it extends when it has none. */
async function claimsOf(root: string, file: string): Promise<Claims> {
  const found: Partial<Record<"files" | "include" | "exclude", string[]>> = {};
  let current: string | undefined = file;
  for (let depth = 0; current && depth < MAX_CONFIGS; depth++) {
    const config = await readConfig(current);
    if (!config) break;
    for (const key of ["files", "include", "exclude"] as const) {
      if (found[key] || !Array.isArray(config[key])) continue;
      found[key] = config[key].map((pattern: string) =>
        insideFolder(root, dirname(current!), pattern),
      );
    }
    current =
      typeof config.extends === "string" && config.extends.startsWith(".")
        ? resolve(dirname(current), config.extends)
        : undefined;
  }
  // tsc's defaults: everything next to the config when it names no files.
  const include =
    found.include ??
    (found.files ? [] : [insideFolder(root, dirname(file), "**/*")]);
  return { files: found.files, include, exclude: found.exclude ?? [] };
}

async function firstFileOnlyClaimedBy(
  root: string,
  own: Claims,
  earlier: Claims[],
) {
  const ours = (path: string) =>
    claims(own, path) && !earlier.some((other) => claims(other, path));
  for (const path of own.files ?? []) if (ours(path)) return path;
  const looked = { count: 0 };
  for (const pattern of own.include) {
    for await (const path of sourceFiles(root, fixedStart(pattern), looked))
      if (ours(path)) return path;
  }
  return undefined;
}

function claims(project: Claims, path: string) {
  const listed = project.files?.includes(path) ?? false;
  const included = project.include.some((pattern) => matches(path, pattern));
  const excluded = project.exclude.some((pattern) => matches(path, pattern));
  return listed || (included && !excluded);
}

/** A pattern without wildcards names a file or everything in a folder; "" is the whole folder. */
function matches(path: string, pattern: string) {
  if (pattern === "") return true;
  if (!/[*?]/.test(pattern))
    return path === pattern || path.startsWith(`${pattern}/`);
  return posix.matchesGlob(path, pattern);
}

/** The folder a pattern's matches are all in: its segments before the first wildcard. */
function fixedStart(pattern: string) {
  const segments = pattern.split("/");
  const wild = segments.findIndex((segment) => /[*?]/.test(segment));
  return (wild === -1 ? segments : segments.slice(0, wild)).join("/");
}

/** TypeScript files at or under `start`, nearest first, skipping dependencies and hidden folders. */
async function* sourceFiles(
  root: string,
  start: string,
  looked: { count: number },
) {
  if (SOURCE.test(start)) yield start;
  const folders = [start];
  while (folders.length && looked.count < MAX_LOOKED_AT) {
    const folder = folders.shift()!;
    const entries = await readdir(join(root, folder), {
      withFileTypes: true,
    }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      looked.count++;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) folders.push(path);
      else if (SOURCE.test(entry.name)) yield path;
    }
  }
}

/** `pattern`, written relative to `base`, as a path inside `root`. */
function insideFolder(root: string, base: string, pattern: string) {
  return relative(root, resolve(base, pattern)).split(sep).join("/");
}

async function readConfig(file: string): Promise<Config | undefined> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  const value: unknown = parse(text, [], { allowTrailingComma: true });
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Config)
    : undefined;
}
