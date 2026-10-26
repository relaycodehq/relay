// A row of an agent's trace told by what its calls did: a muted verb, then
// the file or pattern it was about. It opens to the code the calls wrote,
// else to what ran and came back.
import { useContext, type ReactNode } from "react";
import {
  Check,
  FilePen,
  FilePlus2,
  FileText,
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
import { baseName, isScratch, shownCommand, type CallAction } from "../../../shared/call-actions";
import {
  actionVerb,
  rowFailed,
  rowRunning,
  shortPattern,
  shortWhere,
  type TraceRow,
} from "../../../shared/trace-tree";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import { Spinner } from "../../ui/ui";
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
  test: FlaskConical,
  check: ListChecks,
  commit: GitCommitHorizontal,
  git: GitCommitHorizontal,
  run: Terminal,
  tool: Wrench,
};

/** A file as the trace names it: its icon, its folder dimmed, then its name. */
export function FileChip({ path, lines }: { path: string; lines?: string[] }) {
  const { display } = useContext(Subagents);
  const shown = display(path);
  const folder = shown.split("/").filter(Boolean).at(-2);
  return (
    <span className="trace-chip" title={shown}>
      <FileEntryIcon path={path} directory={false} />
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

/** A finished test or check says how it went beside its verb. */
function Outcome({ action }: { action: CallAction }) {
  if (action.kind !== "test" && action.kind !== "check") return null;
  return action.failed ? <X size={12} className="trace-bad" /> : <Check size={12} className="trace-good" />;
}

export function ActionLabel({
  row,
  live = false,
  shine = false,
}: {
  row: TraceRow;
  live?: boolean;
  /** The verb shimmers: the turn's one live row. */
  shine?: boolean;
}) {
  return (
    <span className="trace-label">
      <span className={shine ? "trace-verb live-shine" : "trace-verb"}>{actionVerb(row, live)}</span>{" "}
      <ActionObject row={row} />
      {row.ranToo && <span className="trace-then">and ran it</span>}
      {!live && <Outcome action={row.action} />}
    </span>
  );
}

/** What a row's calls show opened: the code they wrote, then what ran and came back. */
export function CallsOpened({ calls, onChanges }: { calls: AgentActivity[]; onChanges: () => void }) {
  const { display } = useContext(Subagents);
  return (
    <div className="trace-opened">
      {calls.map((call) => {
        const read = readCode(call);
        return (
          <div key={call.id}>
            {call.written?.map((file) => (
              <WrittenCode key={file.path} file={file} shownPath={display(file.path)} />
            ))}
            {read && <ReadCode read={read} />}
            {!read && call.kind === "command" && (
              <pre className="trace-output">
                <span className="trace-output-command">{shownCommand(call.label)}</span>
                {call.detail ? `\n${call.detail}` : ""}
              </pre>
            )}
            {!read && call.kind !== "command" && showsDetail(call) && (
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

/** What a call printed, unless it only confirms the code shown above it; a failure always says why. */
const showsDetail = (call: AgentActivity) =>
  Boolean(call.detail) && (!call.written?.length || call.status === "failed");

/** Something to show opened: code it wrote, output, or a command to read whole. */
const opens = (calls: AgentActivity[]) =>
  calls.some((c) => c.written?.length || c.detail || c.kind === "command" || c.kind === "file");

function RowShell({
  icon,
  label,
  calls,
  failed,
  onChanges,
}: {
  icon: ReactNode;
  label: ReactNode;
  calls: AgentActivity[];
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
  if (!opens(calls))
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
      <CallsOpened calls={calls} onChanges={onChanges} />
    </Fold>
  );
}

export function ActionRow({ row, onChanges }: { row: TraceRow; onChanges: () => void }) {
  const running = rowRunning(row);
  const Icon = actionIcons[row.action.kind];
  return (
    <RowShell
      icon={running ? <Spinner size={14} /> : <Icon size={14} />}
      label={<ActionLabel row={row} live={running} />}
      calls={row.calls}
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
      calls={[...first.calls, ...second.calls.filter((c) => !first.calls.includes(c))]}
      failed={false}
      onChanges={onChanges}
    />
  );
}
