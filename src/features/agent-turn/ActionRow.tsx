// A row of an agent's trace told by what its calls did: a muted verb, then
// the file or pattern it was about. It opens to the code the calls wrote,
// else to what ran and came back.
import { useContext, type ReactNode } from "react";
import {
  Check,
  FilePen,
  FilePlus2,
  FileText,
  FileX2,
  FlaskConical,
  GitCommitHorizontal,
  Globe,
  Image,
  ListChecks,
  Search,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import type { AgentActivity } from "../../../shared/projects";
import { readCode } from "../../../shared/read-code";
import { callActions, isScratch, shownCommand, type CallAction } from "../../../shared/call-actions";
import { baseName } from "../../../shared/shell-words";
import {
  actionVerb,
  rowFailed,
  rowRunning,
  shortPattern,
  shortWhere,
  showsOutput,
  verdictStopped,
  type TraceRow,
} from "../../../shared/trace-tree";
import { Fold, Subagents } from "./ToolRow";
import { ReadCode } from "./ReadCode";
import { WrittenCode } from "./WrittenCode";

export const actionIcons: Record<CallAction["kind"], typeof FileText> = {
  read: FileText,
  image: Image,
  search: Search,
  web: Globe,
  edit: FilePen,
  create: FilePlus2,
  delete: FileX2,
  test: FlaskConical,
  check: ListChecks,
  commit: GitCommitHorizontal,
  git: GitCommitHorizontal,
  run: Terminal,
  tool: Wrench,
};

/** A file as the trace names it: its folder dimmed, then its name. The row's icon already says what was done to it. */
export function FileChip({ path, lines }: { path: string; lines?: string[] }) {
  const { display } = useContext(Subagents);
  const shown = display(path);
  const folder = shown.split("/").filter(Boolean).at(-2);
  return (
    <span className="trace-chip" title={shown}>
      <span>
        {folder && <span className="trace-chip-dim">{folder}/</span>}
        {baseName(shown)}
      </span>
      {lines && <span className="trace-chip-dim">L{lines.join(", ")}</span>}
    </span>
  );
}

export const CodeChip = ({ children }: { children: ReactNode }) => (
  <code className="trace-code">{children}</code>
);

/** Where a search looked: a file as a chip, a folder as plain text. */
function Where({ where }: { where: string }) {
  const oneFile = /\.\w+$/.test(where) && !where.includes(" ");
  return (
    <>
      {" in "}
      {oneFile ? <FileChip path={where} /> : <span className="trace-where">{shortWhere(where)}</span>}
    </>
  );
}

/** What follows the verb: the file, pattern or program. `withWhere` false when a pair says it once. */
export function ActionObject({ row, withWhere = true }: { row: TraceRow; withWhere?: boolean }) {
  const a = row.action;
  switch (a.kind) {
    case "read":
      return <FileChip path={a.file} lines={row.lines} />;
    case "image":
    case "edit":
    case "create":
    case "delete":
      return <FileChip path={a.file} />;
    case "search":
      return (
        <>
          <CodeChip>{shortPattern(a.pattern)}</CodeChip>
          {withWhere && a.where && <Where where={a.where} />}
        </>
      );
    case "web":
      return <CodeChip>{a.query}</CodeChip>;
    case "test":
      return a.target ? <FileChip path={a.target} /> : null;
    case "commit":
      return (
        <>
          {a.hash && <CodeChip>{a.hash.slice(0, 8)}</CodeChip>}{" "}
          <span className="trace-subject">{a.subject}</span>
        </>
      );
    case "run":
    case "git":
      return <CodeChip>{a.what}</CodeChip>;
    default:
      return null;
  }
}

/** A finished test or check says how it went beside its verb; one stopped first says nothing more. */
function Outcome({ row }: { row: TraceRow }) {
  const { action } = row;
  if (action.kind !== "test" && action.kind !== "check") return null;
  if (action.failed) return <X size={12} className="trace-bad" />;
  return verdictStopped(row) ? null : <Check size={12} className="trace-good" />;
}

/** `live` while its call runs: the verb says so and shines, the row's one moving part. */
export function ActionLabel({ row, live = false }: { row: TraceRow; live?: boolean }) {
  return (
    <span className="trace-label">
      <span className={live ? "trace-verb live-shine" : "trace-verb"}>{actionVerb(row, live)}</span>{" "}
      <ActionObject row={row} />
      {row.ranToo && !live && <span className="trace-then">and ran it</span>}
      {!live && <Outcome row={row} />}
    </span>
  );
}

/** What a row's calls show opened: the code they wrote, then what ran and came back; a call's output once, under its first row. */
function CallsOpened({ rows, onChanges }: { rows: TraceRow[]; onChanges: () => void }) {
  const { display } = useContext(Subagents);
  return (
    <div className="trace-opened">
      {callsOf(rows).map((call) => {
        const read = readCode(call);
        const printed = rows.some((row) => row.calls.includes(call) && showsOutput(row, call));
        return (
          <div key={call.id}>
            {writtenFor(rows, call).map((file, index) => (
              <WrittenCode key={`${index}:${file.path}`} file={file} shownPath={display(file.path)} />
            ))}
            {read && <ReadCode read={read} />}
            {!read && call.kind === "command" && (
              <pre className="trace-output">
                <span className="trace-output-command">{shownCommand(call.label)}</span>
                {printed && call.detail ? `\n${call.detail}` : ""}
              </pre>
            )}
            {!read && call.kind !== "command" && printed && showsDetail(call) && (
              <pre className="trace-output">{call.detail}</pre>
            )}
            {call.kind === "file" && !isScratch(call.label) && (
              <button className="trace-changes" onClick={onChanges}>
                Open working changes
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const callsOf = (rows: TraceRow[]) => [...new Set(rows.flatMap((row) => row.calls))];

const filesWritten = (action: CallAction) =>
  action.kind === "edit" || action.kind === "create" || action.kind === "delete" ? [action.file] : [];

/**
 * The code a call wrote that these rows are about: a call that wrote three
 * files has a row for each. A file none of the call's actions names, its
 * opener cut off the label, goes with whichever row opens.
 */
function writtenFor(rows: TraceRow[], call: AgentActivity) {
  const about = new Set(rows.flatMap((row) => filesWritten(row.action)));
  const named = new Set(callActions(call).flatMap(filesWritten));
  return (call.written ?? []).filter((file) => about.has(file.path) || !named.has(file.path));
}

/** What a call printed, unless it only confirms the code shown above it; a failure always says why. */
const showsDetail = (call: AgentActivity) =>
  Boolean(call.detail) && (!call.written?.length || call.status === "failed");

/** Something to show opened: code it wrote, output, or a command to read whole. */
const opens = (calls: AgentActivity[]) =>
  calls.some((c) => c.written?.length || c.detail || c.kind === "command" || c.kind === "file");

function RowShell({
  icon,
  label,
  rows,
  failed,
  onChanges,
}: {
  icon: ReactNode;
  label: ReactNode;
  rows: TraceRow[];
  failed: boolean;
  onChanges: () => void;
}) {
  const state = failed ? " failed" : "";
  const heading = (
    <>
      {icon}
      {label}
    </>
  );
  if (!opens(callsOf(rows)))
    return (
      <div className={`agent-step trace-row${state}`}>
        <div className="agent-step-heading">{heading}</div>
      </div>
    );
  return (
    <Fold
      className={`agent-step trace-row${state}`}
      summary={<summary className="agent-step-heading">{heading}</summary>}
    >
      <CallsOpened rows={rows} onChanges={onChanges} />
    </Fold>
  );
}

export function ActionRow({ row, onChanges }: { row: TraceRow; onChanges: () => void }) {
  const running = rowRunning(row);
  const Icon = actionIcons[row.action.kind];
  return (
    <RowShell
      icon={<Icon size={14} />}
      label={<ActionLabel row={row} live={running} />}
      rows={[row]}
      failed={rowFailed(row)}
      onChanges={onChanges}
    />
  );
}

/** Two rows one verb carries: "Read a.ts and b.ts". */
export function PairRow({ rows, onChanges }: { rows: [TraceRow, TraceRow]; onChanges: () => void }) {
  const [first, second] = rows;
  const Icon = actionIcons[first.action.kind];
  const whereOf = (row: TraceRow) => (row.action.kind === "search" ? row.action.where : undefined);
  // Two searches of one place say where once, at the end.
  const sharedWhere = whereOf(first) !== undefined && whereOf(first) === whereOf(second) ? whereOf(first) : undefined;
  const label = (
    <span className="trace-label">
      <span className="trace-verb">{actionVerb(first)}</span> <ActionObject row={first} withWhere={!sharedWhere} />
      <span className="trace-verb"> and </span>
      <ActionObject row={second} withWhere={!sharedWhere} />
      {sharedWhere && <Where where={sharedWhere} />}
      {first.ranToo && <span className="trace-then">and ran them</span>}
    </span>
  );
  return (
    <RowShell
      icon={<Icon size={14} />}
      label={label}
      rows={rows}
      failed={false}
      onChanges={onChanges}
    />
  );
}
