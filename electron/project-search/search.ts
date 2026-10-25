import { open } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultMatchLimit,
  type ProjectSearchFile,
  type ProjectSearchQuery,
  type ProjectSearchResult,
} from "../../shared/project-search";
import { digest } from "../util/hash";
import { findExecutable } from "../platform/executables";
import { parseGlobs, pathFilter, type Globs } from "./glob";
import { maxFileBytes, nodeSearch } from "./node-search";
import {
  PatternRejected,
  ripgrepArgs,
  ripgrepSearch,
  type FoundFile,
} from "./ripgrep";

export const searchTimeoutMs = 20_000;
const hashers = 16;

/** Where a search looks, and how it lists what is there. */
export interface SearchTarget {
  root: string;
  plain: boolean;
  /** The files Git lists (tracked and unignored), or a plain folder's own. */
  files(): Promise<string[]>;
}

let ripgrep: { path: string | null; until: number } | undefined;
const lookAgainAfter = 60_000;

/** Where ripgrep is installed, or null. A miss is remembered for a minute, so installing it needs no restart. */
async function ripgrepPath() {
  if (ripgrep && ripgrep.until > Date.now()) return ripgrep.path;
  const path = await findExecutable("rg").catch(() => null);
  ripgrep = { path, until: Date.now() + (path ? 10 * 60_000 : lookAgainAfter) };
  return path;
}

/** Forgets where ripgrep was found; for tests that put one on PATH. */
export function forgetRipgrep() {
  ripgrep = undefined;
}

/** The digest of each found file's bytes; one that cannot be read any more is dropped. */
async function withVersions(root: string, found: FoundFile[]) {
  const out: (ProjectSearchFile | null)[] = new Array(found.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < found.length) {
      const i = next++;
      const handle = await open(join(root, found[i].path), "r").catch(
        () => null,
      );
      if (!handle) continue;
      try {
        const stat = await handle.stat();
        // rg searched it, so it fit its limit then; a file that grew is not worth hashing for.
        if (stat.size > maxFileBytes * 2) continue;
        out[i] = { ...found[i], version: digest(await handle.readFile()) };
      } finally {
        await handle.close();
      }
    }
  }
  await Promise.all(Array.from({ length: hashers }, worker));
  return out.filter((f): f is ProjectSearchFile => !!f);
}

const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Searches with ripgrep, or returns undefined when it can't: Rust's regex has no lookaround (JavaScript's does), or the install is gone. */
async function ripgrepResult(run: {
  rg: string;
  target: SearchTarget;
  query: ProjectSearchQuery;
  globs: Globs;
  limit: number;
  timeoutMs: number;
  signal: AbortSignal;
}) {
  const { rg, target, query, globs, limit, timeoutMs, signal } = run;
  try {
    const { files, truncated } = await ripgrepSearch({
      rg,
      root: target.root,
      args: ripgrepArgs(query, globs, target.plain),
      limit,
      timeoutMs,
      signal,
    });
    const versioned = signal.aborted
      ? []
      : await withVersions(target.root, files);
    return { files: versioned, truncated };
  } catch (e) {
    const uninstalled = (e as NodeJS.ErrnoException).code === "ENOENT";
    if (uninstalled || e instanceof PatternRejected) return undefined;
    throw e;
  }
}

/**
 * Finds `query` in the workspace's text files: with ripgrep when it is
 * installed, else by reading the files Git lists. Both read a line at a time
 * and skip binaries and anything over 2 MiB. `signal` stops it early; what
 * was found by then is dropped (`cancelled`).
 */
export async function searchProjectText(
  target: SearchTarget,
  query: ProjectSearchQuery,
  signal: AbortSignal,
  options: { rg?: string | null; timeoutMs?: number } = {},
): Promise<ProjectSearchResult> {
  const started = Date.now();
  const limit = query.limit ?? defaultMatchLimit;
  const timeoutMs = options.timeoutMs ?? searchTimeoutMs;
  const globs = parseGlobs(query.include, query.exclude);
  const finish = (
    engine: ProjectSearchResult["engine"],
    files: ProjectSearchFile[],
    truncated: boolean,
  ): ProjectSearchResult =>
    signal.aborted
      ? { files: [], truncated: false, elapsedMs: 0, engine, cancelled: true }
      : {
          files: files.sort(byPath),
          truncated,
          elapsedMs: Date.now() - started,
          engine,
        };
  const rg = options.rg === undefined ? await ripgrepPath() : options.rg;
  if (rg) {
    const found = await ripgrepResult({
      rg,
      target,
      query,
      globs,
      limit,
      timeoutMs,
      signal,
    });
    if (found) return finish("ripgrep", found.files, found.truncated);
  }
  const keep = pathFilter(globs);
  const listed = await target.files();
  const { files, truncated } = await nodeSearch({
    root: target.root,
    files: keep ? listed.filter(keep) : listed,
    query,
    limit,
    deadline: started + timeoutMs,
    signal,
  });
  return finish("node", files, truncated);
}
