import {
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";
import { useCopy } from "../lib/useCopy";
import { cellBlock, toTsv, type CellAt } from "./table-tsv";

const MIN_TABLE_COLUMN_WIDTH = 60;

const grid = (table: HTMLTableElement) =>
  Array.from(table.rows, (row) => Array.from(row.cells));

const cellText = (cell: HTMLTableCellElement) => cell.innerText;

function cellHtml(cell: HTMLTableCellElement) {
  const copy = cell.cloneNode(true) as HTMLTableCellElement;
  copy.querySelectorAll(".markdown-table-resizer").forEach((r) => r.remove());
  return copy.innerHTML;
}

/** The cells a selection inside `table` reaches past their start, or null when it stays in one. */
function selectedCells(table: HTMLTableElement, range: Range) {
  const touched: CellAt[] = [];
  const cellRange = document.createRange();
  grid(table).forEach((cells, row) =>
    cells.forEach((cell, col) => {
      cellRange.selectNodeContents(cell);
      if (
        range.compareBoundaryPoints(Range.START_TO_END, cellRange) > 0 &&
        range.compareBoundaryPoints(Range.END_TO_START, cellRange) < 0
      )
        touched.push({ row, col });
    }),
  );
  if (touched.length < 2) return null;
  const block = cellBlock(touched)!;
  return grid(table)
    .slice(block.top, block.bottom + 1)
    .map((cells) => cells.slice(block.left, block.right + 1));
}

/**
 * ⌘C across cells copies them as tab-separated text, so a spreadsheet pastes
 * a grid instead of one cell per line, and as an HTML table of those cells.
 * A selection inside one cell copies as usual.
 */
function copySelectedCells(
  event: ReactClipboardEvent,
  table: HTMLTableElement | null,
) {
  const selection = window.getSelection();
  if (!table || !selection?.rangeCount || selection.isCollapsed) return;
  if (
    !table.contains(selection.anchorNode) ||
    !table.contains(selection.focusNode)
  )
    return;
  const cells = selectedCells(table, selection.getRangeAt(0));
  if (!cells) return;
  event.preventDefault();
  event.clipboardData.setData(
    "text/plain",
    toTsv(cells.map((row) => row.map(cellText))),
  );
  event.clipboardData.setData(
    "text/html",
    `<table>${cells
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${cellHtml(cell)}</td>`).join("")}</tr>`,
      )
      .join("")}</table>`,
  );
}

// Columns size themselves until the first drag; after that the table switches to
// fixed layout with the measured widths so each column can be dragged freely.
export function MarkdownTable({ children }: { children?: ReactNode }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [widths, setWidths] = useState<number[] | null>(null);
  const [copied, copy] = useCopy();
  const startResize = (event: ReactPointerEvent<HTMLTableElement>) => {
    const handle = (event.target as HTMLElement).closest(
      ".markdown-table-resizer",
    );
    const cell = handle?.parentElement as HTMLTableCellElement | null;
    const headerRow = tableRef.current?.rows[0];
    if (!handle || !cell || !headerRow || event.button !== 0) return;
    event.preventDefault();
    const index = cell.cellIndex;
    const initial = Array.from(headerRow.cells, (headerCell) =>
      Math.round(headerCell.getBoundingClientRect().width),
    );
    const startX = event.clientX;
    setWidths(initial);
    const move = (moveEvent: PointerEvent) => {
      const next = [...initial];
      next[index] = Math.max(
        MIN_TABLE_COLUMN_WIDTH,
        initial[index] + moveEvent.clientX - startX,
      );
      setWidths(next);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("resizing-table-column");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    document.body.classList.add("resizing-table-column");
  };
  // The button sits outside the scroller so it stays put when wide tables scroll.
  return (
    <div className={`markdown-table-frame${widths ? " resized" : ""}`}>
      <div className={`markdown-table${widths ? " resized" : ""}`}>
        <table
          ref={tableRef}
          className={widths ? "resized" : undefined}
          style={
            widths
              ? { width: widths.reduce((sum, width) => sum + width, 0) }
              : undefined
          }
          onPointerDown={startResize}
          onDoubleClick={(event) => {
            if (
              (event.target as HTMLElement).closest(".markdown-table-resizer")
            )
              setWidths(null);
          }}
          onCopy={(event) => copySelectedCells(event, tableRef.current)}
        >
          {widths && (
            <colgroup>
              {widths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
          )}
          {children}
        </table>
      </div>
      <button
        type="button"
        className="markdown-table-copy"
        title={copied ? "Copied" : "Copy table for a spreadsheet"}
        aria-label={copied ? "Copied" : "Copy table as tab-separated text"}
        onClick={() => {
          const table = tableRef.current;
          if (table) copy(toTsv(grid(table).map((row) => row.map(cellText))));
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}
