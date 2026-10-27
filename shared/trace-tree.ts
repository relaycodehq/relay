// How a finished run of tool calls reads: grouped by what the calls did, not
// by the order they came in. Between two lines of commentary the reads share
// a branch, the searches another, the commands a third; one or two calls of a
// kind stay a row ("Read a.ts and b.ts"). The desktop and both phone apps
// draw this; RelayKit and the Android tests hold their ports to its fixtures.
import type { AgentActivity } from "./projects";
import { callActions, isScratch, type CallAction } from "./call-actions";
import { baseName } from "./shell-words";

/** One row: a thing done, by one call or a few that did the same thing. */
export interface TraceRow {
  id: string;
  action: CallAction;
  calls: AgentActivity[];
  /** The lines each read of the file printed; none when a read took it whole. */
  lines?: string[];
  /** A script written, then run straight after. */
  ranToo?: boolean;
}

export type BranchKind = "read" | "search" | "web" | "edit" | "run" | "git" | "check" | "commit" | "tool";

export type TracePiece =
  | { kind: "row"; row: TraceRow }
  | { kind: "pair"; rows: [TraceRow, TraceRow] }
  | { kind: "branch"; branch: BranchKind; heading: string; rows: TraceRow[] };

export const rowRunning = (row: TraceRow) => row.calls.some((c) => c.status === "running");

/** A test or check stopped before it said how it went. */
export const verdictStopped = (row: TraceRow) =>
  (row.action.kind === "test" || row.action.kind === "check") &&
  !row.action.failed &&
  row.calls.some((c) => c.status === "stopped");

/** A test or check fails by its result; anything else only when its call failed there. */
export function rowFailed(row: TraceRow) {
  if (row.action.kind === "test" || row.action.kind === "check") return row.action.failed;
  return row.calls.some((c) => c.status === "failed" && failedAt(c, row.action));
}

/** Every row failed: only then does the branch or run holding them say it failed. */
export const allFailed = (rows: TraceRow[]) => rows.length > 0 && rows.every(rowFailed);

/**
 * A shell exits with its last command's status, so a failed call failed at
 * the last thing it did: in `git log; cat dir/*`, the cat, not the log.
 */
function failedAt(call: AgentActivity, action: CallAction) {
  const last = shownActions(call).at(-1);
  return !last || sameThing(last.action, action);
}

/** A run of calls between two lines of commentary, as rows, pairs and branches. */
export const traceTree = (calls: AgentActivity[]) => traceRun(calls).pieces;

/**
 * A run's tree and, once it's longer than two lines, its folded line, from
 * one pass over the calls.
 */
export function traceRun(calls: AgentActivity[]): { pieces: TracePiece[]; summary?: string } {
  const grouped = branches(rowsOf(calls));
  const tree = grouped.flatMap(([kind, rows]) =>
    kind === "run" ? commandRuns(rows).flatMap((run) => pieces(kind, run)) : pieces(kind, rows),
  );
  return tree.length < 3 ? { pieces: tree } : { pieces: tree, summary: summaryOf(grouped) };
}

/**
 * What a call did worth a row, each with where it stands among the call's
 * actions: a commit's own `git log` says nothing new, and a running call has
 * only started its first part.
 */
function shownActions(call: AgentActivity) {
  const actions = callActions(call).map((action, index) => ({ action, index }));
  if (call.status === "running") return actions.slice(0, 1);
  const commits = actions.some(({ action }) => action.kind === "commit");
  return commits ? actions.filter(({ action }) => action.kind !== "git") : actions;
}

/**
 * A row per thing done; a file read twice running, or a script written then
 * run, share one. A row is named by its call and action, so it keeps its id
 * when a call before it finishes and grows rows.
 */
export function rowsOf(calls: AgentActivity[]): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const call of calls)
    for (const { action, index } of shownActions(call)) {
      const last = rows.at(-1);
      if (last && sameRead(last.action, action)) {
        if (!last.calls.includes(call)) last.calls.push(call);
        last.lines = linesOfBoth(last.lines, action.kind === "read" && action.lines ? [action.lines] : undefined);
        continue;
      }
      if (last && ranWhatItWrote(last.action, action)) {
        if (!last.calls.includes(call)) last.calls.push(call);
        last.ranToo = true;
        continue;
      }
      const lines = action.kind === "read" && action.lines ? [action.lines] : undefined;
      rows.push({ id: `${call.id}:${index}`, action, calls: [call], ...(lines ? { lines } : {}) });
    }
  return rows;
}

/**
 * Whether a row shows what its call printed: a call that did several things
 * prints it under the row of the first, and its other rows show only what ran.
 */
export function showsOutput(row: TraceRow, call: AgentActivity) {
  const [first, second] = shownActions(call);
  return !first || !second || sameThing(row.action, first.action);
}

/** Two actions about one thing; reads of a file are, whatever lines each kept. */
function sameThing(a: CallAction, b: CallAction) {
  if (a.kind !== b.kind) return false;
  return "file" in a && "file" in b ? a.file === b.file : JSON.stringify(a) === JSON.stringify(b);
}

/** Two reads of a file together: each one's lines, or none once either took the whole file. */
function linesOfBoth(earlier: string[] | undefined, later: string[] | undefined) {
  return earlier && later ? [...earlier, ...later] : undefined;
}

const sameRead = (a: CallAction, b: CallAction) =>
  a.kind === "read" && b.kind === "read" && a.file === b.file;

const ranWhatItWrote = (wrote: CallAction, ran: CallAction) =>
  (wrote.kind === "create" || wrote.kind === "edit") &&
  ran.kind === "run" &&
  ran.what === baseName(wrote.file);

/** Which branch a row hangs on; a script written to /tmp to run is one of the commands. */
export function branchOf(action: CallAction): BranchKind {
  switch (action.kind) {
    case "read":
    case "image":
      return "read";
    case "search":
      return "search";
    case "web":
      return "web";
    case "edit":
    case "create":
    case "delete":
      return isScratch(action.file) ? "run" : "edit";
    case "test":
    case "check":
      return "check";
    case "commit":
      return "commit";
    case "git":
      return "git";
    case "tool":
      return "tool";
    default:
      return "run";
  }
}

/** Rows by branch, in the order each first came up; a file read or edited again joins its first row. */
function branches(rows: TraceRow[]) {
  const byKind = new Map<BranchKind, TraceRow[]>();
  for (const row of rows) {
    const kind = branchOf(row.action);
    const branch = byKind.get(kind) ?? [];
    const earlier = branch.find((r) => sameFile(r, row));
    if (earlier) {
      earlier.calls.push(...row.calls.filter((c) => !earlier.calls.includes(c)));
      earlier.lines = linesOfBoth(earlier.lines, row.lines);
    } else byKind.set(kind, [...branch, row]);
  }
  return [...byKind];
}

/** Two reads, or two edits, of one file; a script written and run stays apart. */
function sameFile(a: TraceRow, b: TraceRow) {
  const bothReads = a.action.kind === "read" && b.action.kind === "read";
  const bothEdits = a.action.kind === "edit" && b.action.kind === "edit";
  if (!(bothReads || bothEdits) || a.ranToo || b.ranToo) return false;
  return "file" in a.action && "file" in b.action && a.action.file === b.action.file;
}

/** Commands split at each script written for them, so a write isn't buried in "Ran 7 commands". */
function commandRuns(rows: TraceRow[]) {
  const runs: TraceRow[][] = [];
  for (const row of rows) {
    const last = runs.at(-1);
    const wrote = isWrite(row.action);
    if (last && !wrote && !isWrite(last[0]!.action)) last.push(row);
    else runs.push([row]);
  }
  return runs;
}

const isWrite = (action: CallAction) => action.kind === "create" || action.kind === "edit";

/** One row alone, two as one sentence when one verb carries both, three and up a branch. */
function pieces(kind: BranchKind, rows: TraceRow[]): TracePiece[] {
  if (rows.length === 1) return [{ kind: "row", row: rows[0]! }];
  if (rows.length === 2) {
    const pair = rows as [TraceRow, TraceRow];
    return pairable(pair) ? [{ kind: "pair", rows: pair }] : pair.map((row) => ({ kind: "row", row }));
  }
  return [{ kind: "branch", branch: kind, heading: branchHeading(kind, rows), rows }];
}

/** Two rows one verb can carry: same action, both settled and fine, said the same way. */
function pairable([a, b]: [TraceRow, TraceRow]) {
  const sameAction = a.action.kind === b.action.kind && pairVerbs.has(a.action.kind);
  const settled = ![a, b].some(rowRunning) && ![a, b].some(rowFailed);
  return sameAction && settled && Boolean(a.ranToo) === Boolean(b.ranToo);
}

/** Kinds two rows of can share one line; two pictures keep their own rows, each with its thumbnail. */
const pairVerbs = new Set<CallAction["kind"]>(["read", "search", "web", "edit", "create", "delete", "run", "git"]);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "once", "twice", "3 times": a run's folded line can name one or two. */
function times(count: number) {
  if (count === 1) return "once";
  return count === 2 ? "twice" : `${count} times`;
}

const distinctFiles = (rows: TraceRow[]) =>
  new Set(rows.map((r) => ("file" in r.action ? r.action.file : r.id))).size;

/** "Read 4 files", "Ran rg 3 times", "Ran 2 checks · 1 failed". */
export function branchHeading(kind: BranchKind, rows: TraceRow[]) {
  switch (kind) {
    case "read":
      return `Read ${plural(distinctFiles(rows), "file")}`;
    case "search":
      return `Searched ${times(rows.length)}`;
    case "web":
      return `Searched the web ${times(rows.length)}`;
    case "edit":
      return `Edited ${plural(distinctFiles(rows), "file")}`;
    case "run":
      return runHeading(rows);
    case "git":
      return `Checked git ${times(rows.length)}`;
    case "check": {
      const failed = rows.filter(rowFailed).length;
      return `Ran ${plural(rows.length, "check")}${failed ? ` · ${failed} failed` : ""}`;
    }
    case "commit":
      return `Committed ${times(rows.length)}`;
    case "tool":
      return rows.every((r) => r.calls.every((c) => c.kind === "agent"))
        ? `Ran ${plural(rows.length, "agent")}`
        : `Used ${plural(rows.length, "tool")}`;
  }
}

/** Commands all of one program say which: "Ran rg 3 times". Counted as the rows under it. */
function runHeading(rows: TraceRow[]) {
  const programs = new Set(rows.map((r) => (r.action.kind === "run" ? r.action.what.split(" ")[0] : r.id)));
  const [program] = programs;
  if (programs.size !== 1) return `Ran ${plural(rows.length, "command")}`;
  return rows.length === 1 ? `Ran ${program}` : `Ran ${program} ${rows.length} times`;
}

/** How many kinds a folded run's line names before "and N more". */
const summaryKinds = 3;

/**
 * A run the agent has moved on from, as one line: "Searched 2 times, read 4
 * files and ran 3 commands". None for a tree of two lines or fewer, which
 * shows as it is.
 */
export const runSummary = (calls: AgentActivity[]) => traceRun(calls).summary;

function summaryOf(grouped: ReturnType<typeof branches>) {
  const parts = grouped.map(([kind, rows], i) => {
    const heading = branchHeading(kind, rows);
    return i === 0 ? heading : heading.charAt(0).toLowerCase() + heading.slice(1);
  });
  if (parts.length > summaryKinds) return `${parts.slice(0, summaryKinds - 1).join(", ")} and ${parts.length - summaryKinds + 1} more`;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * The verb a row leads with, past or, while it runs, present. Tools draw
 * their own row. A script written and then running is running.
 */
export function actionVerb(row: TraceRow, live = false): string {
  const a = row.action;
  if (live && row.ranToo) return "Running";
  switch (a.kind) {
    case "read":
      return live ? "Reading" : "Read";
    case "image":
      return live ? "Looking at" : "Looked at";
    case "search":
      return live ? "Searching" : "Searched";
    case "web":
      return live ? "Searching the web for" : "Searched the web for";
    case "edit":
      return live ? "Editing" : "Edited";
    case "create":
      return live ? "Writing" : "Wrote";
    case "delete":
      return live ? "Deleting" : "Deleted";
    case "test":
      if (live) return "Running tests";
      return `Tests ${verdictWord(row)}`;
    case "check":
      if (live) return `Running ${a.name}`;
      return `${capitalized(a.name)} ${verdictWord(row)}`;
    case "commit":
      return live ? "Committing" : "Committed";
    case "git":
      return live ? "Checking" : "Checked";
    case "run":
      return live ? "Running" : "Ran";
    case "tool":
      return "";
  }
}

function verdictWord(row: TraceRow) {
  if (rowFailed(row)) return "failed";
  return verdictStopped(row) ? "stopped" : "passed";
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A grep's alternation reads as its first word, without its escapes. */
export function shortPattern(pattern: string) {
  const first = pattern.split("\\|")[0]!.replace(/^\^|\\b|\$$/g, "").replace(/\\(.)/g, "$1");
  return first.length > 34 ? `${first.slice(0, 32)}…` : first;
}

/** Where a search looked: a path's last two folders. */
export function shortWhere(where: string) {
  const parts = where.split(" ")[0]!.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/");
}
