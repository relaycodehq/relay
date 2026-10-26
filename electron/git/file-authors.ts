import type { FileAuthors, FileAuthorsQuery } from "../../shared/file-authors";
import { git } from "./git";

/** Revisions don't change, so neither does who wrote their lines. */
const cache = new Map<string, Promise<FileAuthors>>();
const CACHED = 30;

/** Who wrote each line of the file at the revision, from one `git blame`. */
export function fileAuthors(folder: string, query: FileAuthorsQuery): Promise<FileAuthors> {
  const key = JSON.stringify([folder, query.revision, query.path]);
  const known = cache.get(key);
  if (known) return known;
  const reading = blameFile(folder, query);
  cache.set(key, reading);
  if (cache.size > CACHED) cache.delete(cache.keys().next().value!);
  reading.catch(() => cache.delete(key));
  return reading;
}

async function blameFile(folder: string, query: FileAuthorsQuery) {
  const output = await git(
    folder,
    [
      "-c",
      "blame.ignoreRevsFile=",
      "blame",
      "--porcelain",
      "--no-textconv",
      "--root",
      query.revision,
      "--",
      query.path,
    ],
    {
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024,
      env: { GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1" },
    },
  );
  return authorsOf(output);
}

/**
 * Reads `git blame --porcelain`: a header names each line's commit and its
 * place, and a commit's author comes only after its first header.
 */
export function authorsOf(porcelain: string): FileAuthors {
  const authors: string[] = [];
  const indexOf = new Map<string, number>();
  const authorOf = new Map<string, number>();
  const lines: number[] = [];
  let commit = "";
  let line = 0;
  for (const row of porcelain.split("\n")) {
    if (row.startsWith("\t")) {
      lines[line - 1] = authorOf.get(commit) ?? -1;
      continue;
    }
    const header = /^([a-f0-9]{40,64}) \d+ (\d+)/.exec(row);
    if (header) {
      [, commit] = header;
      line = Number(header[2]);
      continue;
    }
    if (row.startsWith("author ") && !authorOf.has(commit)) {
      const name = row.slice("author ".length).slice(0, 300);
      if (!indexOf.has(name)) indexOf.set(name, authors.push(name) - 1);
      authorOf.set(commit, indexOf.get(name)!);
    }
  }
  return { authors, lines: Array.from(lines, (index) => index ?? -1) };
}
