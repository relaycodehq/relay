import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ProjectSearchFile } from "../../../shared/project-search";
import { buildRows, openTargetOf, type ResultRow } from "./search-model";

const FILE_ROW_HEIGHT = 26;
const LINE_ROW_HEIGHT = 22;

const rowKey = (row: ResultRow) =>
  row.kind === "file"
    ? `f:${row.file.path}`
    : `l:${row.file.path}:${row.first.line}:${row.first.column}`;

const withToggled = (paths: ReadonlySet<string>, path: string) => {
  const next = new Set(paths);
  if (!next.delete(path)) next.add(path);
  return next;
};

/**
 * The matches as a tree you can fold and move through: files with their
 * lines, which file headers are folded, which files a replace leaves out,
 * and the selected row. Folded and left-out files belong to one list of
 * results, so a new list starts over.
 */
export function useResultTree(files: readonly ProjectSearchFile[]) {
  const scroller = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    setCollapsed(new Set());
    setExcluded(new Set());
    setSelected(0);
  }, [files]);

  const rows = useMemo(
    () => buildRows(files, collapsed, excluded),
    [files, collapsed, excluded],
  );
  const selectedIndex = Math.min(selected, rows.length - 1);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) =>
      rows[i]?.kind === "file" ? FILE_ROW_HEIGHT : LINE_ROW_HEIGHT,
    getItemKey: (i) => rowKey(rows[i]),
    overscan: 12,
  });

  return {
    scroller,
    virtual,
    rows,
    selectedIndex,
    selectedRow: rows[selectedIndex] as ResultRow | undefined,
    excluded,
    setSelected,
    openTargetAt: (i: number) => openTargetOf(rows[i]),
    /** Moves the selection, clamped to the list, and scrolls it into view. */
    moveSelection(i: number) {
      if (!rows.length) return;
      const next = Math.max(0, Math.min(rows.length - 1, i));
      setSelected(next);
      virtual.scrollToIndex(next, { align: "auto" });
    },
    fold(path: string, folded: boolean) {
      setCollapsed((was) => {
        const next = new Set(was);
        if (folded) next.add(path);
        else next.delete(path);
        return next;
      });
    },
    toggleLeftOut: (path: string) =>
      setExcluded((was) => withToggled(was, path)),
  };
}

export type ResultTree = ReturnType<typeof useResultTree>;
