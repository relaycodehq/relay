import { z } from "zod";
import type {
  ProjectSearchMatch,
  ProjectSearchQuery,
} from "../../shared/project-search";
import { spawnExecutable } from "../platform/executables";
import { terminate } from "../platform/terminate";
import { ripgrepGlobArgs, type Globs } from "./glob";
import { matchPreview } from "./preview";

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
    ...ripgrepGlobArgs(globs),
    "--max-filesize",
    "2M",
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

/** Offsets in `line` as ripgrep counts them (UTF-8 bytes), as UTF-16 units. */
function unitOffsets(line: string) {
  if (line.length === Buffer.byteLength(line)) return (byte: number) => byte;
  const bytes = Buffer.from(line);
  return (byte: number) => bytes.subarray(0, byte).toString("utf8").length;
}

/** The matches in one line of ripgrep's `--json` output; none for any other event or a name that isn't text. */
export function parseRipgrepLine(raw: string): FoundFile | null {
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = matchEvent.safeParse(event);
  if (!parsed.success) return null;
  const { path, lines, line_number, submatches } = parsed.data.data;
  const unit = unitOffsets(lines.text);
  const matches = submatches.flatMap((m) =>
    m.end > m.start
      ? [
          matchPreview(
            lines.text,
            line_number,
            unit(m.start),
            unit(m.end) - unit(m.start),
          ),
        ]
      : [],
  );
  if (!matches.length) return null;
  return {
    path: path.text.replace(/^\.[\\/]/, "").replaceAll("\\", "/"),
    matches,
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
 * file. Once `limit` matches are in, `onFull` is called and later lines are
 * ignored, as they are whenever `stopped()` says so.
 */
function collectMatches(
  limit: number,
  stopped: () => boolean,
  onFull: () => void,
) {
  const files = new Map<string, ProjectSearchMatch[]>();
  let count = 0;
  let unfinishedLine = "";
  const take = (raw: string) => {
    if (stopped()) return;
    const found = raw ? parseRipgrepLine(raw) : null;
    if (!found) return;
    const list = files.get(found.path) ?? [];
    files.set(found.path, list);
    for (const match of found.matches) {
      if (count >= limit) return onFull();
      list.push(match);
      count++;
    }
  };
  return {
    get count() {
      return count;
    },
    feed(chunk: string) {
      unfinishedLine += chunk;
      let end = unfinishedLine.indexOf("\n");
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
 * Runs ripgrep and collects its matches as they stream in. Stops it once
 * `limit` matches are in, when `signal` fires, or after `timeoutMs`; the
 * first two and the last are `truncated` unless the signal is the reason.
 */
export function ripgrepSearch(options: {
  rg: string;
  root: string;
  args: string[];
  limit: number;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<{ files: FoundFile[]; truncated: boolean }> {
  const { rg, root, args, limit, timeoutMs, signal } = options;
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
