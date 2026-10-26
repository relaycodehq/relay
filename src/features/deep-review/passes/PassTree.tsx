import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  formatLines,
  readLines,
  type ChangedFile,
} from "../../../../shared/review-passes";
import { MAX_PASSES } from "../../../../shared/suggest-passes";
import {
  changeTree,
  filesByPass,
  moveToPass,
  passesFrom,
  sharesOf,
  treeRows,
  type PassFiles,
  type Share,
  type TreeRow,
} from "./pass-tree";
import type { ReviewPasses } from "./useReviewPasses";
import "./pass-tree.css";

type Destination = number | "new";

/**
 * The change's folders with a column for each pass: click a pass's number on
 * a row, or press it with the pointer over the row, to move that folder.
 */
export function PassTree({
  passes: p,
  files,
}: {
  passes: ReviewPasses;
  files: ChangedFile[];
}) {
  const top = useMemo(() => changeTree(files), [files]);
  const byPass = filesByPass(p.shown, top);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const canAdd = byPass.length < MAX_PASSES;
  const move = (row: TreeRow, to: Destination) => {
    if (to === "new" && !canAdd) return;
    p.setPasses(passesFrom(moveToPass(byPass, row.files, to), top));
  };
  const hover = useMoveKeys(byPass.length, move);
  return (
    <div className="pass-tree">
      <div className="pass-tree-head">
        <span className="deep-review-note">
          Click a pass's number to move a folder there, or press it over the row
        </span>
        <PassSizes byPass={byPass} files={files} canAdd={canAdd} />
      </div>
      <ul className="pass-tree-rows">
        {treeRows(top, byPass, opened).map((row) => (
          <PassTreeRow
            key={row.path}
            row={row}
            shares={sharesOf(row.files, byPass)}
            canAdd={canAdd}
            onMove={(to) => move(row, to)}
            onToggle={() => setOpened({ ...opened, [row.path]: !row.open })}
            onHover={hover}
          />
        ))}
      </ul>
    </div>
  );
}

/** Over each pass's column, the lines it reads. */
function PassSizes({
  byPass,
  files,
  canAdd,
}: {
  byPass: PassFiles;
  files: ChangedFile[];
  canAdd: boolean;
}) {
  const lines = new Map(files.map((f) => [f.path, readLines(f)]));
  return (
    <span className="pass-tree-cells">
      {byPass.map((pass, i) => {
        const read = pass.reduce((n, path) => n + (lines.get(path) ?? 0), 0);
        return (
          <span
            key={i}
            className="pass-tree-size"
            title={`Pass ${i + 1}: ${formatLines(read)}`}
          >
            {read ? formatLines(read).replace(/ lines?$/, "") : "–"}
          </span>
        );
      })}
      {canAdd && <span className="pass-tree-size">new</span>}
    </span>
  );
}

function PassTreeRow({
  row,
  shares,
  canAdd,
  onMove,
  onToggle,
  onHover,
}: {
  row: TreeRow;
  shares: Share[];
  canAdd: boolean;
  onMove: (to: Destination) => void;
  onToggle: () => void;
  onHover: (row: TreeRow | undefined) => void;
}) {
  return (
    <li
      className="pass-tree-row"
      style={{ paddingLeft: row.depth * 16 }}
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHover(undefined)}
    >
      {row.folder ? (
        <button
          type="button"
          className="pass-tree-chevron"
          aria-expanded={row.open}
          aria-label={row.open ? `Close ${row.label}` : `Open ${row.label}`}
          onClick={onToggle}
        >
          <ChevronRight size={12} />
        </button>
      ) : (
        <span className="pass-tree-chevron" />
      )}
      <span
        className={`deep-review-pass-paths${row.folder ? "" : " pass-tree-file"}`}
        title={row.path}
      >
        {row.label}
      </span>
      <span className="deep-review-note pass-tree-lines">
        {formatLines(row.lines)}
      </span>
      <span className="pass-tree-cells">
        {shares.map((share, i) => (
          <button
            key={i}
            type="button"
            className="pass-tree-cell"
            data-share={share}
            aria-label={`Move ${row.path} to pass ${i + 1}`}
            onClick={() => onMove(i)}
          >
            {i + 1}
          </button>
        ))}
        {canAdd && (
          <button
            type="button"
            className="pass-tree-cell"
            data-share="none"
            aria-label={`Give ${row.path} a pass of its own`}
            title="A pass of its own"
            onClick={() => onMove("new")}
          >
            +
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * A pass's number, or `n` for a new pass, moves the row under the pointer.
 * Returns what to call as the pointer enters and leaves rows.
 */
function useMoveKeys(
  passes: number,
  move: (row: TreeRow, to: Destination) => void,
) {
  const hovered = useRef<TreeRow>(undefined);
  const latest = useRef({ passes, move });
  latest.current = { passes, move };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const row = hovered.current;
      const typing = (e.target as HTMLElement | null)?.closest(
        "input, textarea, [contenteditable]",
      );
      if (!row || typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const to = destinationFor(e.key, latest.current.passes);
      if (to === undefined) return;
      e.preventDefault();
      latest.current.move(row, to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (row: TreeRow | undefined) => {
    hovered.current = row;
  };
}

function destinationFor(key: string, passes: number): Destination | undefined {
  if (key === "n") return "new";
  const number = Number(key);
  if (Number.isInteger(number) && number >= 1 && number <= passes)
    return number - 1;
  return undefined;
}
