import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectSearchQuery } from "../../shared/project-search";
import { digest } from "../util/hash";
import { hitsIn, searchRegExp } from "./matcher";
import { matchPreview } from "./preview";
import type { FoundFile } from "./ripgrep";

/** Files past this are not searched, as ripgrep's `--max-filesize 2M`. */
export const maxFileBytes = 2 * 1024 * 1024;
const readers = 16;

export interface NodeFound extends FoundFile {
  version: string;
}

/**
 * The file's text, or null when it is not one to search: gone, a link, not a
 * regular file, too large, binary or not UTF-8.
 */
async function readText(root: string, path: string) {
  const handle = await open(
    join(root, path),
    // A link in the tree must not lead the search out of it.
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  ).catch(() => null);
  if (!handle) return null;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxFileBytes) return null;
    const bytes = await handle.readFile();
    if (bytes.includes(0)) return null;
    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bytes,
        ),
        version: digest(bytes),
      };
    } catch {
      return null;
    }
  } finally {
    await handle.close();
  }
}

/** The matches in `text`, line by line, at most `room` of them; `full` says there were more. */
function matchesIn(text: string, re: RegExp, room: number) {
  const matches = [];
  // A CRLF line ends before its \r, as ripgrep's --crlf and replace read it.
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    for (const hit of hitsIn(re, line)) {
      if (matches.length >= room) return { matches, full: true };
      matches.push(matchPreview(line, i + 1, hit.index, hit.length));
    }
  }
  return { matches, full: false };
}

/**
 * Searches `files` (relative to `root`) without ripgrep, reading several at a
 * time. Matches what `rg` finds in the same files: one line at a time, no
 * binary files, nothing over 2 MiB. Stops at `limit` matches, `deadline` or
 * `signal`.
 */
export async function nodeSearch(options: {
  root: string;
  files: string[];
  query: ProjectSearchQuery;
  limit: number;
  deadline: number;
  signal: AbortSignal;
}): Promise<{ files: NodeFound[]; truncated: boolean }> {
  const { root, files, query, limit, deadline, signal } = options;
  const re = searchRegExp(query);
  // A whole-file pass with ^ and $ per line tells most files have nothing in them before any line is cut.
  const probe = new RegExp(re.source, re.flags.replace("g", "") + "m");
  const found = new Map<number, NodeFound>();
  let count = 0;
  let nextFile = 0;
  let truncated = false;
  const shouldStop = () => {
    if (count >= limit || Date.now() > deadline) truncated = true;
    return truncated || signal.aborted;
  };
  async function worker() {
    while (nextFile < files.length && !shouldStop()) {
      const index = nextFile++;
      const path = files[index];
      const file = await readText(root, path);
      if (!file || !probe.test(file.text)) continue;
      const { matches, full } = matchesIn(file.text, re, limit - count);
      count += matches.length;
      if (full) truncated = true;
      if (matches.length)
        found.set(index, { path, matches, version: file.version });
    }
  }
  await Promise.all(Array.from({ length: readers }, worker));
  return {
    files: [...found].sort((a, b) => a[0] - b[0]).map(([, file]) => file),
    truncated: truncated && !signal.aborted,
  };
}
