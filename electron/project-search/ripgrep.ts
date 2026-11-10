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

/**
 * `output` is each match as JSON, or only the names of the files that have
 * one, separated by NUL.
 */
export function ripgrepArgs(
  query: ProjectSearchQuery,
  globs: Globs,
  plain: boolean,
  output: "matches" | "files" = "matches",
) {
  return [
    ...(output === "matches" ? ["--json"] : ["--files-with-matches", "--null"]),
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

/** A path as ripgrep prints it (`./src\\a.ts`) in the project's own form (`src/a.ts`). */
const projectPath = (printed: string) =>
  printed.replace(/^\.[\\/]/, "").replaceAll("\\", "/");

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
    path: projectPath(path.text),
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

/** What a run of ripgrep hands its output to, and what it makes of it. */
interface Collector<T> {
  feed(chunk: string): void;
  /** The last piece, which has no separator after it. */
  finish(): void;
  readonly count: number;
  result(): T;
}

/** What a collector may do to the run it is part of. */
interface RunControl {
  stopped(): boolean;
  /** Ends the run early; what it has so far is `truncated`. */
  stopTruncated(): void;
}

/** Cuts ripgrep's output into pieces at `separator`, scanning each new chunk only once. */
function splitter(
  separator: string,
  stopped: () => boolean,
  take: (piece: string) => void,
) {
  let unfinished = "";
  return {
    feed(chunk: string) {
      // The text before the chunk has no separator, so it is not searched again.
      const fresh = unfinished.length;
      unfinished += chunk;
      let end = unfinished.indexOf(separator, fresh);
      while (end >= 0 && !stopped()) {
        take(unfinished.slice(0, end));
        unfinished = unfinished.slice(end + separator.length);
        end = unfinished.indexOf(separator);
      }
    },
    finish: () => take(unfinished),
  };
}

/**
 * Keeps ripgrep's matches, grouped by file, in the files `keep` lets
 * through. Once `limit` matches are in the run is stopped, and later lines
 * are ignored.
 */
function matchCollector(
  limit: number,
  keep: ((path: string) => boolean) | undefined,
  control: RunControl,
): Collector<FoundFile[]> {
  const files = new Map<string, ProjectSearchMatch[]>();
  let count = 0;
  const take = (raw: string) => {
    if (control.stopped()) return;
    const found = raw ? parseRipgrepLine(raw, limit - count) : null;
    if (!found) return;
    if (keep && !keep(found.path)) return;
    const list = files.get(found.path) ?? [];
    list.push(...found.matches);
    count += found.matches.length;
    // A file goes in only with a match, so the cap never leaves one empty.
    if (list.length) files.set(found.path, list);
    if (found.more) control.stopTruncated();
  };
  return {
    ...splitter("\n", control.stopped, take),
    get count() {
      return count;
    },
    result: () => [...files].map(([path, matches]) => ({ path, matches })),
  };
}

/** Keeps the names of the files ripgrep says have a match, in the ones `keep` lets through. */
function nameCollector(
  keep: ((path: string) => boolean) | undefined,
  control: RunControl,
): Collector<string[]> {
  const paths: string[] = [];
  const take = (printed: string) => {
    if (control.stopped() || !printed) return;
    const path = projectPath(printed);
    if (!keep || keep(path)) paths.push(path);
  };
  return {
    ...splitter("\0", control.stopped, take),
    get count() {
      return paths.length;
    },
    result: () => paths,
  };
}

/**
 * Runs ripgrep and hands its output to a collector as it streams in. Stops it
 * when the collector says so, when `signal` fires, or after `timeoutMs`; all
 * but the signal are `truncated`.
 */
function runRipgrep<T>(
  options: {
    rg: string;
    root: string;
    args: string[];
    timeoutMs: number;
    signal: AbortSignal;
  },
  collect: (control: RunControl) => Collector<T>,
): Promise<{ found: T; truncated: boolean }> {
  const { rg, root, args, timeoutMs, signal } = options;
  return new Promise((resolve, reject) => {
    if (signal.aborted)
      return resolve({
        found: collect({ stopped: () => true, stopTruncated() {} }).result(),
        truncated: false,
      });
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
    const collected = collect({
      stopped: () => truncated,
      stopTruncated() {
        truncated = true;
        stop();
      },
    });
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
        found: collected.result(),
        truncated: truncated && !signal.aborted,
      });
    });
  });
}

interface RipgrepRun {
  rg: string;
  root: string;
  args: string[];
  keep?: (path: string) => boolean;
  timeoutMs: number;
  signal: AbortSignal;
}

/**
 * Runs ripgrep and collects its matches as they stream in, from the files
 * `keep` lets through. Stops it once `limit` matches are in, when `signal`
 * fires, or after `timeoutMs`; the first two and the last are `truncated`
 * unless the signal is the reason.
 */
export async function ripgrepSearch(
  options: RipgrepRun & { limit: number },
): Promise<{ files: FoundFile[]; truncated: boolean }> {
  const { limit, keep, ...run } = options;
  const { found, truncated } = await runRipgrep(run, (control) =>
    matchCollector(limit, keep, control),
  );
  return { files: found, truncated };
}

/**
 * Runs ripgrep for the names of the files it finds a match in (the `args`
 * come from `ripgrepArgs` with output "files"), from the ones `keep` lets
 * through.
 */
export async function ripgrepFiles(
  options: RipgrepRun,
): Promise<{ paths: string[]; truncated: boolean }> {
  const { keep, ...run } = options;
  const { found, truncated } = await runRipgrep(run, (control) =>
    nameCollector(keep, control),
  );
  return { paths: found, truncated };
}
