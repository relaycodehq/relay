import type { ProjectCheckState } from "../../../shared/checks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChangedFile, Progress } from "../../../shared/types";
import type { ChangeGroup, TriageResult } from "../../../shared/triage";
import { foldedPaths, listRows, rowHeight, rowKey } from "./file-list-rows";
import { FileRow, GroupRow, ViewedFold } from "./FileListRows";
import { GroupInspect } from "./GroupInspect";
import type { FileSelection } from "./usePullSelection";
import { useRevealSelected } from "./useRevealSelected";

interface Props {
  checks?: ProjectCheckState | null;
  files: ChangedFile[];
  selection: FileSelection;
  onSelect: (path: string) => void;
  progress: Progress;
  revision: string;
  /** Viewed files a later push changed; they read as unviewed again. */
  changedSinceViewed?: Set<string>;
  result?: TriageResult;
  groups: ChangeGroup[];
  filter: string;
  plain: boolean;
  onReviewGroup: (group: ChangeGroup, viewed: boolean) => Promise<void>;
}

export function GroupedFileList({
  checks,
  files,
  selection,
  onSelect,
  progress,
  revision,
  changedSinceViewed,
  result,
  groups,
  filter,
  plain,
  onReviewGroup,
}: Props) {
  const selected = selection.path;
  const [open, setOpen] = useState<Set<string>>(new Set()),
    [inspect, setInspect] = useState<ChangeGroup | null>(null),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState(""),
    [viewedOpen, setViewedOpen] = useState(false),
    // Group actions taken with the pointer on the list keep their rows in
    // place until it leaves, so nothing moves out from under the cursor.
    [held, setHeld] = useState<Map<string, boolean>>(new Map());
  const pointerInside = useRef(false);
  useEffect(() => {
    setOpen(new Set());
    setInspect(null);
    setError("");
    setHeld(new Map());
  }, [revision]);
  const grouping = !plain && groups.length > 0;
  /** Paths that sit in the Viewed section: viewed files, and complete groups. */
  const folded = useMemo(
    () =>
      foldedPaths(
        files,
        grouping ? groups : null,
        (p) => held.get(p) ?? progress.read[p] === revision,
      ),
    [files, groups, grouping, progress.read, revision, held],
  );
  const rows = useMemo(
    () =>
      listRows({
        files,
        groups: grouping ? groups : null,
        folded,
        filter,
        open,
        viewedOpen,
      }),
    [files, groups, grouping, folded, filter, open, viewedOpen],
  );
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: (i) => rowHeight(rows[i]),
    overscan: 8,
    getItemKey: (i) => rowKey(rows[i]),
  });
  useRevealSelected({
    selection,
    revision,
    rows,
    groups,
    plain,
    open,
    filter,
    folded,
    viewedOpen,
    setOpen,
    setViewedOpen,
    virtual,
  });
  const reviewGroup = async (group: ChangeGroup) => {
    if (busy) return;
    setBusy(group.id);
    setError("");
    if (pointerInside.current)
      setHeld((previous) => {
        const next = new Map(previous);
        for (const p of group.paths)
          if (!next.has(p)) next.set(p, folded.has(p));
        return next;
      });
    try {
      await onReviewGroup(
        group,
        !group.paths.every((p) => progress.read[p] === revision),
      );
      setOpen((previous) => {
        const next = new Set(previous);
        next.delete(group.id);
        return next;
      });
      setInspect(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update this group.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div
        className="file-virtual"
        ref={parent}
        onPointerEnter={() => (pointerInside.current = true)}
        onPointerLeave={() => {
          pointerInside.current = false;
          if (held.size) setHeld(new Map());
        }}
      >
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((v) => {
            const row = rows[v.index],
              style = {
                height: v.size,
                position: "absolute" as const,
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${v.start}px)`,
              };
            if (row.type === "label")
              return (
                <div key={v.key} className="file-section-label" style={style}>
                  {row.text}
                </div>
              );
            if (row.type === "fold")
              return (
                <ViewedFold
                  key={v.key}
                  style={style}
                  count={row.count}
                  expanded={viewedOpen || !!filter}
                  filtering={!!filter}
                  onToggle={() => setViewedOpen((o) => !o)}
                />
              );
            if (row.type === "group") {
              const { group } = row;
              return (
                <GroupRow
                  key={v.key}
                  style={style}
                  group={group}
                  viewed={
                    group.paths.filter((p) => progress.read[p] === revision)
                      .length
                  }
                  expanded={open.has(group.id) || !!filter}
                  busy={busy}
                  onToggle={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  onInspect={() => {
                    setInspect(group);
                    setError("");
                  }}
                  onReview={() => void reviewGroup(group)}
                />
              );
            }
            const f = row.file,
              read = progress.read[f.filename] === revision;
            return (
              <FileRow
                key={v.key}
                style={style}
                file={f}
                grouped={row.grouped}
                active={selected === f.filename}
                read={read}
                changed={!read && !!changedSinceViewed?.has(f.filename)}
                checks={checks}
                note={result?.ordinary[f.filename]}
                onSelect={() => onSelect(f.filename)}
              />
            );
          })}
        </div>
      </div>
      {error && !inspect && (
        <div className="group-action-error">
          <p role="alert">{error}</p>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {inspect && (
        <GroupInspect
          group={inspect}
          provider={result?.provider ?? "codex"}
          isRead={(path) => progress.read[path] === revision}
          busy={!!busy}
          error={error}
          onOpenFile={(path) => {
            onSelect(path);
            setInspect(null);
          }}
          onReview={() => void reviewGroup(inspect)}
          onClose={() => {
            if (!busy) setInspect(null);
          }}
        />
      )}
    </>
  );
}
