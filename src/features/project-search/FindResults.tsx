import type { CSSProperties } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { IconButton } from "../../ui/ui";
import { Highlight } from "./Highlight";
import { PathLabel } from "./PathLabel";
import type { ResultRow } from "./search-model";
import type { ResultTree } from "./useResultTree";

type FileRow = Extract<ResultRow, { kind: "file" }>;
type LineRow = Extract<ResultRow, { kind: "line" }>;

interface RowProps<R> {
  row: R;
  style: CSSProperties;
  selected: boolean;
}

function FileResult(
  props: RowProps<FileRow> & {
    showReplace: boolean;
    onClick: () => void;
    onDoubleClick: () => void;
    onToggleLeftOut: () => void;
  },
) {
  const { row, selected } = props;
  const Chevron = row.collapsed ? ChevronRight : ChevronDown;
  return (
    <div
      className="ps-result"
      role="treeitem"
      aria-expanded={!row.collapsed}
      aria-selected={selected}
      data-kind="file"
      data-active={selected ? "" : undefined}
      data-excluded={row.excluded ? "" : undefined}
      style={props.style}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
    >
      <Chevron size={13} className="ps-chevron" />
      <PathLabel path={row.file.path} />
      <span className="ps-count">{row.count}</span>
      {props.showReplace && (
        <IconButton
          label={row.excluded ? "Include in replace" : "Leave out of replace"}
          className="ps-exclude"
          onClick={(e) => {
            e.stopPropagation(); // the row's click folds it
            props.onToggleLeftOut();
          }}
        >
          <X size={12} />
        </IconButton>
      )}
    </div>
  );
}

function LineResult(props: RowProps<LineRow> & { onClick: () => void }) {
  const { row, selected } = props;
  return (
    <div
      className="ps-result"
      role="treeitem"
      aria-selected={selected}
      data-active={selected ? "" : undefined}
      data-excluded={row.excluded ? "" : undefined}
      style={props.style}
      onClick={props.onClick}
    >
      <span className="ps-line-no">{row.first.line}</span>
      <span className="ps-line-code">
        <Highlight text={row.first.preview} ranges={row.hits} />
      </span>
    </div>
  );
}

/** The matches, one virtual row per file header or matching line. */
export function FindResults(props: {
  tree: ResultTree;
  showReplace: boolean;
  emptyNote?: string;
  onOpen: (index: number) => void;
}) {
  const { tree, showReplace, onOpen } = props;
  const { virtual } = tree;
  return (
    <div
      ref={tree.scroller}
      className="ps-find-results"
      tabIndex={0}
      role="tree"
      aria-label="Matches"
    >
      {props.emptyNote && <p className="ps-find-empty">{props.emptyNote}</p>}
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((item) => {
          const row = tree.rows[item.index];
          if (!row) return null;
          const style = {
            height: item.size,
            transform: `translateY(${item.start}px)`,
          };
          const selected = item.index === tree.selectedIndex;
          if (row.kind === "line")
            return (
              <LineResult
                key={item.key}
                row={row}
                style={style}
                selected={selected}
                onClick={() => {
                  tree.setSelected(item.index);
                  onOpen(item.index);
                }}
              />
            );
          return (
            <FileResult
              key={item.key}
              row={row}
              style={style}
              selected={selected}
              showReplace={showReplace}
              onClick={() => {
                tree.setSelected(item.index);
                tree.fold(row.file.path, !row.collapsed);
              }}
              onDoubleClick={() => onOpen(item.index)}
              onToggleLeftOut={() => tree.toggleLeftOut(row.file.path)}
            />
          );
        })}
      </div>
    </div>
  );
}
