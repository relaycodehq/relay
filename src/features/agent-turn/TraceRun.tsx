// A finished run of tool calls, grouped by what the calls did
// (shared/trace-tree): single rows, pairs said as one sentence, and branches
// that fold open into a tree.
import { useContext, useRef } from "react";
import type { AgentActivity } from "../../../shared/projects";
import { baseName } from "../../../shared/call-actions";
import {
  actionVerb,
  branchOf,
  rowFailed,
  runSummary,
  traceTree,
  type BranchKind,
  type TracePiece,
  type TraceRow,
} from "../../../shared/trace-tree";
import { ActionRow, actionIcons, PairRow } from "./ActionRow";
import { Fold, Subagents, ToolRow } from "./ToolRow";
import "./trace-tree.css";

/** Tools, agents, questions and pictures keep the row that knows them; the rest say what they did. */
function Row({ row, onChanges }: { row: TraceRow; onChanges: () => void }) {
  const { display } = useContext(Subagents);
  const ownRow = row.action.kind === "tool" || row.action.kind === "image";
  if (!ownRow) return <ActionRow row={row} onChanges={onChanges} />;
  // A picture keeps its thumbnail and peek, and still says what was done with it.
  const label = (call: AgentActivity) =>
    row.action.kind === "image" ? `${actionVerb(row)} ${baseName(display(call.label))}` : display(call.label);
  return (
    <>
      {row.calls.map((call) => (
        <ToolRow key={call.id} activity={call} label={label(call)} onChanges={onChanges} />
      ))}
    </>
  );
}

const branchIcons: Record<BranchKind, keyof typeof actionIcons> = {
  read: "read",
  search: "search",
  web: "web",
  edit: "edit",
  run: "run",
  check: "test",
  commit: "commit",
  tool: "tool",
};

function Branch({ piece, onChanges }: { piece: Extract<TracePiece, { kind: "branch" }>; onChanges: () => void }) {
  const Icon = actionIcons[branchIcons[piece.branch]];
  const failed = piece.branch === "check" && piece.rows.some(rowFailed);
  return (
    <Fold
      className={`agent-step trace-branch${failed ? " failed" : ""}`}
      summary={
        <summary className="agent-step-heading">
          <Icon size={14} />
          <span>{piece.heading}</span>
        </summary>
      }
    >
      <div className="trace-tree">
        {piece.rows.map((row) => (
          <div key={row.id} className="trace-tree-row">
            <Row row={row} onChanges={onChanges} />
          </div>
        ))}
      </div>
    </Fold>
  );
}

/** The run's tree and its folded line, built again only when one of its calls changed: the turn hands over a new array every render. */
function usePieces(calls: AgentActivity[]) {
  const built = useRef<{ calls: AgentActivity[]; pieces: TracePiece[]; summary?: string }>(undefined);
  const same = built.current?.calls.length === calls.length && calls.every((c, i) => c === built.current!.calls[i]);
  if (!same) built.current = { calls, pieces: traceTree(calls), summary: runSummary(calls) };
  return built.current!;
}

function Piece({ piece, onChanges }: { piece: TracePiece; onChanges: () => void }) {
  switch (piece.kind) {
    case "row":
      return <Row row={piece.row} onChanges={onChanges} />;
    case "pair":
      return <PairRow rows={piece.rows} onChanges={onChanges} />;
    case "branch":
      return <Branch piece={piece} onChanges={onChanges} />;
  }
}

const pieceKey = (piece: TracePiece) => (piece.kind === "row" ? piece.row.id : piece.rows[0]!.id);

export function TraceRun({ calls, onChanges }: { calls: AgentActivity[]; onChanges: () => void }) {
  const { pieces } = usePieces(calls);
  return (
    <>
      {pieces.map((piece) => (
        <Piece key={pieceKey(piece)} piece={piece} onChanges={onChanges} />
      ))}
    </>
  );
}

/** What kind the run started with, for its folded line's icon. */
function firstKind(piece: TracePiece): BranchKind {
  if (piece.kind === "branch") return piece.branch;
  return branchOf(piece.kind === "row" ? piece.row.action : piece.rows[0].action);
}

/**
 * A run the agent has moved on from, once a line of commentary or the end of
 * the turn closed it: one line when its tree is long, opening to that tree.
 * `arrived` fades the line in as it takes over from the live row.
 */
export function ClosedRun({
  calls,
  arrived,
  onChanges,
}: {
  calls: AgentActivity[];
  arrived: boolean;
  onChanges: () => void;
}) {
  const { pieces, summary } = usePieces(calls);
  if (!summary) return <TraceRun calls={calls} onChanges={onChanges} />;
  const Icon = actionIcons[branchIcons[firstKind(pieces[0]!)]];
  return (
    <Fold
      className={`agent-step trace-branch trace-closed${arrived ? " arrived" : ""}`}
      summary={
        <summary className="agent-step-heading">
          <Icon size={14} />
          <span>{summary}</span>
        </summary>
      }
    >
      <div className="trace-tree">
        {pieces.map((piece) => (
          <div key={pieceKey(piece)} className="trace-tree-row">
            <Piece piece={piece} onChanges={onChanges} />
          </div>
        ))}
      </div>
    </Fold>
  );
}
