import { z } from "zod";
import type {
  ProjectSearchMatch,
  ProjectSearchQuery,
} from "../../shared/project-search";
import { spawnExecutable } from "../platform/executables";
import { terminate } from "../platform/terminate";
import { ripgrepExcludeArgs, type Globs } from "./glob";
import { matchPreview, withoutLineEnd } from "./preview";

/** ripgrep refused the pattern, which another regex engine may still take (lookaround, backreferences). */
export class PatternRejected extends Error {}

export interface FoundFile {
  path: string;
  matches: ProjectSearchMatch[];
}

export function ripgrepArgs(
  query: ProjectSearchQuery,
  globs: Globs,
  plain: boolean,
) {
  return [
    "--json",
    "--no-config",
    // Dotfiles are code too; Git's own folder is not.
    "--hidden",
    "--glob",
    "!.git",
    // Nothing tells a plain folder which dependencies to leave out.
    ...(plain ? ["--glob", "!node_modules"] : []),
    ...ripgrepExcludeArgs(globs.exclude),
    "--max-filesize",
    "2M",
    // `$` ends a CRLF line before its \r, as it does when replacing.
    "--crlf",
    query.caseSensitive ? "--case-sensitive" : "--ignore-case",
    ...(query.wholeWord ? ["--word-regexp"] : []),
    ...(query.regex ? [] : ["--fixed-strings"]),
    "-e",
    query.pattern,
    // A path given, so a stdin that is a pipe is never searched instead.
    ".",
  ];
}

const textField = z.object({ text: z.string() });

const matchEvent = z.object({
  type: z.literal("match"),
  data: z.object({
    path: textField,
    lines: textField,
    line_number: z.number(),
    submatches: z.array(z.object({ start: z.number(), end: z.number() })),
  }),
});

/**
 * ripgrep counts offsets in UTF-8 bytes; this gives the same positions as
 * UTF-16 units. `bytes` must be ascending, and the line is read once however
 * many there are.
 */
function unitOffsets(line: string, bytes: number[]) {
  if (line.length === Buffer.byteLength(line)) return bytes;
  const units: number[] = [];
  let byte = 0;
  let unit = 0;
  for (const wanted of bytes) {
    while (byte < wanted && unit < line.length) {
      const point = line.codePointAt(unit) as number;
      byte += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
      unit += point > 0xffff ? 2 : 1;
    }
    units.push(unit);
  }
  return units;
}

export interface FoundLine extends FoundFile {
  /** The line had more matches than `room`, which were not read. */
  more: boolean;
}

/**
 * The matches in one line of ripgrep's `--json` output, at most `room` of
 * them; none for any other event or a name that isn't text.
 */
export function parseRipgrepLine(
  raw: string,
  room = Infinity,
): FoundLine | null {
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = matchEvent.safeParse(event);
  if (!parsed.success) return null;
  const { path, lines, line_number, submatches } = parsed.data.data;
  const hits = submatches.filter((m) => m.end > m.start);
  if (!hits.length) return null;
  const wanted = hits.slice(0, room);
  const text = withoutLineEnd(lines.text);
  const offsets = unitOffsets(
    lines.text,
    wanted.flatMap((m) => [m.start, m.end]),
  );
  return {
    path: path.text.replace(/^\.[\\/]/, "").replaceAll("\\", "/"),
    matches: wanted.map((_, i) =>
      matchPreview(
        text,
        line_number,
        offsets[2 * i],
        offsets[2 * i + 1] - offsets[2 * i],
      ),
    ),
    more: hits.length > wanted.length,
  };
}

const stderrLimit = 4000;
/** Failures that cost some files but not the search: unreadable folders, a file removed mid-walk. */
const harmless = /permission denied|no such file|os error|too many open files/i;
const patternErrors =
  /regex parse error|unrecognized escape|look-around|backreference/i;

/**
 * The error for a ripgrep run that found nothing and exited with 2, or
 * undefined when it only could not enter some folders.
 */
function failureFor(stderr: string) {
  const problem = stderr.trim();
  if (patternErrors.test(problem)) return new PatternRejected(problem);
  if (problem && !harmless.test(problem))
    return new Error(problem.split("\n").slice(0, 3).join(" "));
  return undefined;
}

/**
 * Takes ripgrep's output a chunk at a time and keeps its matches, grouped by
 * file, in the files `keep` lets through. Once `limit` matches are in,
 * `onFull` is called and later lines are ignored, as they are whenever
 * `stopped()` says so.
 */
function collectMatches(
  limit: number,
  keep: ((path: string) => boolean) | undefined,
  stopped: () => boolean,
  onFull: () => void,
) {
  const files = new Map<string, ProjectSearchMatch[]>();
  let count = 0;
  let unfinishedLine = "";
  const take = (raw: string) => {
    if (stopped()) return;
    const found = raw ? parseRipgrepLine(raw, limit - count) : null;
    if (!found) return;
    if (keep && !keep(found.path)) return;
    const list = files.get(found.path) ?? [];
    list.push(...found.matches);
    count += found.matches.length;
    // A file goes in only with a match, so the cap never leaves one empty.
    if (list.length) files.set(found.path, list);
    if (found.more) onFull();
  };
  return {
    get count() {
      return count;
    },
    feed(chunk: string) {
      // The text before the chunk has no newline, so it is not searched again.
      const fresh = unfinishedLine.length;
      unfinishedLine += chunk;
      let end = unfinishedLine.indexOf("\n", fresh);
      while (end >= 0 && !stopped()) {
        take(unfinishedLine.slice(0, end));
        unfinishedLine = unfinishedLine.slice(end + 1);
        end = unfinishedLine.indexOf("\n");
      }
    },
    /** The last line, which has no newline after it. */
    finish: () => take(unfinishedLine),
    files: (): FoundFile[] =>
      [...files].map(([path, matches]) => ({ path, matches })),
  };
}

/**
 * Runs ripgrep and collects its matches as they stream in, from the files
 * `keep` lets through. Stops it once `limit` matches are in, when `signal`
 * fires, or after `timeoutMs`; the first two and the last are `truncated`
 * unless the signal is the reason.
 */
export function ripgrepSearch(options: {
  rg: string;
  root: string;
  args: string[];
  keep?: (path: string) => boolean;
  limit: number;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<{ files: FoundFile[]; truncated: boolean }> {
  const { rg, root, args, keep, limit, timeoutMs, signal } = options;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve({ files: [], truncated: false });
    const child = spawnExecutable(rg, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let truncated = false;
    let stderr = "";
    let spawnError: Error | undefined;
    const stop = () => terminate(child, { graceMs: 500 });
    const collected = collectMatches(
      limit,
      keep,
      () => truncated,
      () => {
        truncated = true;
        stop();
      },
    );
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", collected.feed);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < stderrLimit) stderr += chunk;
    });
    const timer = setTimeout(() => {
      truncated = true;
      stop();
    }, timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    child.once("error", (e) => {
      spawnError = e;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (spawnError) return reject(spawnError);
      if (!signal.aborted) collected.finish();
      // 1 is "no match"; 2 means something failed, perhaps only a folder it could not enter.
      const failed =
        code === 2 && !collected.count && !signal.aborted && !truncated;
      const failure = failed ? failureFor(stderr) : undefined;
      if (failure) return reject(failure);
      resolve({
        files: collected.files(),
        truncated: truncated && !signal.aborted,
      });
    });
  });
}
