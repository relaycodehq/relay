// A finished run of tool calls, grouped by what the calls did
// (shared/trace-tree): single rows, pairs said as one sentence, and branches
// that fold open into a tree.
import { useContext, useRef } from "react";
import type { AgentActivity } from "../../../shared/projects";
import { baseName } from "../../../shared/call-actions";
import {
  actionVerb,
  rowFailed,
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

/** The run's tree, built again only when one of its calls changed: the turn hands over a new array every render. */
function usePieces(calls: AgentActivity[]) {
  const built = useRef<{ calls: AgentActivity[]; pieces: TracePiece[] }>(undefined);
  const same = built.current?.calls.length === calls.length && calls.every((c, i) => c === built.current!.calls[i]);
  if (!same) built.current = { calls, pieces: traceTree(calls) };
  return built.current!.pieces;
}

export function TraceRun({ calls, onChanges }: { calls: AgentActivity[]; onChanges: () => void }) {
  const pieces = usePieces(calls);
  return (
    <>
      {pieces.map((piece) => {
        switch (piece.kind) {
          case "row":
            return <Row key={piece.row.id} row={piece.row} onChanges={onChanges} />;
          case "pair":
            return <PairRow key={piece.rows[0].id} rows={piece.rows} onChanges={onChanges} />;
          case "branch":
            return <Branch key={piece.rows[0]!.id} piece={piece} onChanges={onChanges} />;
        }
      })}
    </>
  );
}
