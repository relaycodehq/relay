// How a finished run of tool calls reads: grouped by what the calls did, not
// by the order they came in. Between two lines of commentary the reads share
// a branch, the searches another, the commands a third; one or two calls of a
// kind stay a row ("Read a.ts and b.ts"). The desktop and both phone apps
// draw this; RelayKit and the Android tests hold their ports to its fixtures.
import type { AgentActivity } from "./projects";
import { baseName, callActions, isScratch, type CallAction } from "./call-actions";

/** One row: a thing done, by one call or a few that did the same thing. */
export interface TraceRow {
  id: string;
  action: CallAction;
  calls: AgentActivity[];
  /** A file read more than once: each read's lines. */
  lines?: string[];
  /** A script written, then run straight after. */
  ranToo?: boolean;
}

export type BranchKind = "read" | "search" | "web" | "edit" | "run" | "check" | "commit" | "tool";

export type TracePiece =
  | { kind: "row"; row: TraceRow }
  | { kind: "pair"; rows: [TraceRow, TraceRow] }
  | { kind: "branch"; branch: BranchKind; heading: string; rows: TraceRow[] };

export const rowRunning = (row: TraceRow) => row.calls.some((c) => c.status === "running");

/** A test or check fails by its result; anything else only when its call failed. */
export function rowFailed(row: TraceRow) {
  if (row.action.kind === "test" || row.action.kind === "check") return row.action.failed;
  return row.calls.some((c) => c.status === "failed");
}

/** A run of calls between two lines of commentary, as rows, pairs and branches. */
export function traceTree(calls: AgentActivity[]): TracePiece[] {
  return branches(rowsOf(calls)).flatMap(([kind, rows]) =>
    kind === "run" ? commandRuns(rows).flatMap((run) => pieces(kind, run)) : pieces(kind, rows),
  );
}

/** What a call did worth a row: a commit's own `git log` says nothing new, and a running call has only started its first part. */
function shownActions(call: AgentActivity) {
  const actions = callActions(call);
  if (call.status === "running") return actions.slice(0, 1);
  return actions.some((a) => a.kind === "commit") ? actions.filter((a) => a.kind !== "git") : actions;
}

/** A row per thing done; a file read twice running, or a script written then run, share one. */
export function rowsOf(calls: AgentActivity[]): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const call of calls)
    for (const action of shownActions(call)) {
      const last = rows.at(-1);
      if (last && sameRead(last.action, action)) {
        if (!last.calls.includes(call)) last.calls.push(call);
        if (action.kind === "read" && action.lines) last.lines = [...(last.lines ?? []), action.lines];
        continue;
      }
      if (last && ranWhatItWrote(last.action, action)) {
        if (!last.calls.includes(call)) last.calls.push(call);
        last.ranToo = true;
        continue;
      }
      const lines = action.kind === "read" && action.lines ? [action.lines] : undefined;
      rows.push({ id: `${call.id}:${rows.length}`, action, calls: [call], ...(lines ? { lines } : {}) });
    }
  return rows;
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
      return isScratch(action.file) ? "run" : "edit";
    case "test":
    case "check":
      return "check";
    case "commit":
      return "commit";
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
      if (row.lines) earlier.lines = [...(earlier.lines ?? []), ...row.lines];
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
const pairVerbs = new Set<CallAction["kind"]>(["read", "search", "web", "edit", "create", "run", "git"]);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const distinctFiles = (rows: TraceRow[]) =>
  new Set(rows.map((r) => ("file" in r.action ? r.action.file : r.id))).size;

/** "Read 4 files", "Ran rg 3 times", "Ran 2 checks · 1 failed". */
export function branchHeading(kind: BranchKind, rows: TraceRow[]) {
  switch (kind) {
    case "read":
      return `Read ${plural(distinctFiles(rows), "file")}`;
    case "search":
      return `Searched ${plural(rows.length, "time")}`;
    case "web":
      return `Searched the web ${plural(rows.length, "time")}`;
    case "edit":
      return `Edited ${plural(distinctFiles(rows), "file")}`;
    case "run":
      return runHeading(rows);
    case "check": {
      const failed = rows.filter(rowFailed).length;
      return `Ran ${plural(rows.length, "check")}${failed ? ` · ${failed} failed` : ""}`;
    }
    case "commit":
      return `Committed ${plural(rows.length, "time")}`;
    case "tool":
      return rows.every((r) => r.calls.every((c) => c.kind === "agent"))
        ? `Ran ${plural(rows.length, "agent")}`
        : `Used ${plural(rows.length, "tool")}`;
  }
}

/**
 * Commands all of one program say which: "Ran rg 3 times". Others count the
 * commands themselves, like the turn's heading: `a; b; c` is one command.
 */
function runHeading(rows: TraceRow[]) {
  const programs = new Set(rows.map((r) => (r.action.kind === "run" ? r.action.what.split(" ")[0] : r.id)));
  const [program] = programs;
  if (programs.size === 1) return `Ran ${program} ${rows.length} times`;
  const commands = new Set(rows.flatMap((r) => r.calls.map((c) => c.id))).size;
  return `Ran ${plural(commands, "command")}`;
}

/** The verb a row leads with, past or, while it runs, present. Tools draw their own row. */
export function actionVerb(row: TraceRow, live = false): string {
  const a = row.action;
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
    case "test":
      if (live) return "Running tests";
      return a.failed ? "Tests failed" : "Tests passed";
    case "check":
      if (live) return `Running ${a.name}`;
      return `${capitalized(a.name)} ${a.failed ? "failed" : "passed"}`;
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
