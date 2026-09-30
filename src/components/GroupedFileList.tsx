import {
  diagnosticSummary,
  diagnosticSeverity,
  type ProjectCheckState,
} from "../../shared/checks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Info,
  Layers3,
} from "lucide-react";
import type { ChangedFile, Progress } from "../../shared/types";
import type { ChangeGroup, TriageResult } from "../../shared/triage";
import { Modal } from "./ui";
import { agentName } from "../../shared/agents";

type Row =
  | { type: "file"; file: ChangedFile; grouped: boolean }
  | { type: "group"; group: ChangeGroup }
  | { type: "label"; text: string }
  | { type: "fold"; count: number };
export interface FileSelection {
  path: string | null;
  /** Explicit navigation reveals the file; bulk review keeps the list in place. */
  reveal: boolean;
}
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
  const folded = useMemo(() => {
    const settled = (p: string) => held.get(p) ?? progress.read[p] === revision;
    const result = new Set<string>(),
      grouped = new Set<string>();
    if (grouping)
      for (const group of groups) {
        group.paths.forEach((p) => grouped.add(p));
        if (group.paths.every(settled))
          group.paths.forEach((p) => result.add(p));
      }
    for (const f of files)
      if (!grouped.has(f.filename) && settled(f.filename))
        result.add(f.filename);
    return result;
  }, [files, groups, grouping, progress.read, revision, held]);
  const rows = useMemo(() => {
    const matches = (f: ChangedFile) =>
      f.filename.toLowerCase().includes(filter.toLowerCase());
    const fileRow = (file: ChangedFile, grouped: boolean): Row => ({
      type: "file",
      file,
      grouped,
    });
    const top: Row[] = [],
      bottom: Row[] = [];
    let count = 0;
    if (!grouping)
      for (const file of files.filter(matches)) {
        const done = folded.has(file.filename);
        (done ? bottom : top).push(fileRow(file, false));
        if (done) count++;
      }
    else {
      const grouped = new Set(groups.flatMap((g) => g.paths)),
        byPath = new Map(files.map((f) => [f.filename, f]));
      for (const group of groups) {
        const members = group.paths
          .map((p) => byPath.get(p))
          .filter((f): f is ChangedFile => !!f && matches(f));
        if (!members.length) continue;
        const done = group.paths.every((p) => folded.has(p)),
          section = done ? bottom : top;
        if (done) count += members.length;
        section.push({ type: "group", group });
        if (open.has(group.id) || filter)
          section.push(...members.map((file) => fileRow(file, true)));
      }
      const normal = files.filter(
        (f) => !grouped.has(f.filename) && matches(f),
      );
      const unviewed = normal.filter((f) => !folded.has(f.filename)),
        viewed = normal.filter((f) => folded.has(f.filename));
      if (unviewed.length)
        top.push(
          { type: "label", text: `Individual changes · ${unviewed.length}` },
          ...unviewed.map((file) => fileRow(file, false)),
        );
      bottom.push(...viewed.map((file) => fileRow(file, false)));
      count += viewed.length;
    }
    if (!bottom.length) return top;
    return [
      ...top,
      { type: "fold", count } as Row,
      ...(viewedOpen || filter ? bottom : []),
    ];
  }, [files, groups, grouping, folded, filter, open, viewedOpen]);
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: (i) =>
      rows[i].type === "group"
        ? 77
        : rows[i].type === "label"
          ? 33
          : rows[i].type === "fold"
            ? 40
            : 49,
    overscan: 8,
    getItemKey: (i) =>
      rows[i].type === "file"
        ? rows[i].file.filename
        : rows[i].type === "group"
          ? rows[i].group.id
          : rows[i].type === "fold"
            ? "viewed-fold"
            : "individual-label",
  });
  const revealed = useRef<{
    selection: FileSelection;
    revision: string;
  } | null>(null);
  useEffect(() => {
    // Row changes are not navigation. Keep a request pending only until its
    // metadata/group becomes available, then consume it once.
    if (
      !selection.reveal ||
      !selected ||
      (revealed.current?.selection === selection &&
        revealed.current.revision === revision)
    )
      return;
    if (folded.has(selected) && !viewedOpen && !filter) {
      setViewedOpen(true);
      return;
    }
    const group = !plain && groups.find((g) => g.paths.includes(selected));
    if (group && !open.has(group.id) && !filter) {
      setOpen((prev) => new Set([...prev, group.id]));
      return;
    }
    const index = rows.findIndex(
      (r) => r.type === "file" && r.file.filename === selected,
    );
    if (index >= 0) {
      revealed.current = { selection, revision };
      // A new selection can resize the controls above the list; wait a frame
      // so the virtualizer has seen the list's new height before scrolling.
      requestAnimationFrame(() =>
        virtual.scrollToIndex(index, { align: "auto" }),
      );
    }
  }, [
    selection,
    selected,
    revision,
    rows,
    groups,
    open,
    plain,
    filter,
    folded,
    viewedOpen,
    virtual,
  ]);
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
            if (row.type === "fold") {
              const expanded = viewedOpen || !!filter;
              return (
                <div key={v.key} className="viewed-fold-row" style={style}>
                  <button
                    className="viewed-fold"
                    aria-expanded={expanded}
                    disabled={!!filter}
                    onClick={() => setViewedOpen((o) => !o)}
                  >
                    {expanded ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                    Viewed
                    <span>{row.count}</span>
                  </button>
                </div>
              );
            }
            if (row.type === "group") {
              const { group } = row,
                viewed = group.paths.filter(
                  (p) => progress.read[p] === revision,
                ).length,
                expanded = open.has(group.id) || !!filter;
              return (
                <div
                  key={v.key}
                  className={`change-group ${viewed === group.paths.length ? "is-viewed" : ""}`}
                  style={style}
                >
                  <div className="group-heading-row">
                    <button
                      className="group-heading"
                      aria-expanded={expanded}
                      title={group.description}
                      onClick={() =>
                        setOpen((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.id)) next.delete(group.id);
                          else next.add(group.id);
                          return next;
                        })
                      }
                    >
                      {expanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <strong>{group.name}</strong>
                      <span>{group.paths.length}</span>
                    </button>
                    <button
                      className="group-info icon-button"
                      aria-label={`About ${group.name}`}
                      title="Group description and files"
                      disabled={!!busy}
                      onClick={() => {
                        setInspect(group);
                        setError("");
                      }}
                    >
                      <Info size={15} />
                    </button>
                  </div>
                  <div className="group-bottom">
                    <span>
                      {viewed === group.paths.length ? (
                        <CheckCheck size={12} />
                      ) : (
                        <Layers3 size={12} />
                      )}{" "}
                      {viewed}/{group.paths.length} viewed
                    </span>
                    <button
                      disabled={!!busy}
                      onClick={() => void reviewGroup(group)}
                    >
                      {busy === group.id
                        ? "Checking…"
                        : viewed === group.paths.length
                          ? "Mark as unviewed"
                          : "Mark as viewed"}
                    </button>
                  </div>
                </div>
              );
            }
            const f = row.file,
              parts = f.filename.split("/"),
              name = parts.pop(),
              read = progress.read[f.filename] === revision,
              changed = !read && !!changedSinceViewed?.has(f.filename),
              checked =
                checks?.status === "ready"
                  ? checks.files[f.filename]
                  : undefined;
            return (
              <button
                key={v.key}
                className={`file-row ${row.grouped ? "group-member" : ""} ${selected === f.filename ? "active" : ""} ${read ? "read" : ""}`}
                style={style}
                title={
                  result?.ordinary[f.filename]
                    ? `${f.filename}\nIndividual review: ${result.ordinary[f.filename]}`
                    : f.filename
                }
                onClick={() => onSelect(f.filename)}
              >
                {read ? <Check size={15} /> : <FileCode2 size={15} />}
                <div>
                  <strong>{name}</strong>
                  <small>
                    {changed && "Changed since viewed · "}
                    {parts.join("/") || "Repository root"}
                  </small>
                </div>
                {checked && diagnosticSeverity(checked) && (
                  <span
                    className={`diagnostic-badge ${diagnosticSeverity(checked)}`}
                    title={`${diagnosticSummary(checked)} in local checkout`}
                    aria-label={diagnosticSummary(checked)}
                  >
                    {checked.errors || checked.warnings || checked.suggestions}
                  </span>
                )}
                <span className={`file-status ${f.status}`}>
                  {f.status === "added"
                    ? "A"
                    : f.status === "deleted"
                      ? "D"
                      : f.status === "renamed"
                        ? "R"
                        : "M"}
                </span>
              </button>
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
        <Modal
          title={inspect.name}
          onClose={() => {
            if (!busy) setInspect(null);
          }}
        >
          <p className="group-description">{inspect.description}</p>
          <p className="field-note">
            {agentName(result?.provider ?? "codex")} suggests these files
            contain only this repeated change. Inspect any file, then mark the
            group viewed for this PR revision. Files with extra edits stay in
            Individual changes.
          </p>
          <div className="group-inspect-files">
            {inspect.paths.map((path) => (
              <button
                key={path}
                title={path}
                onClick={() => {
                  onSelect(path);
                  setInspect(null);
                }}
              >
                {progress.read[path] === revision ? (
                  <Check size={14} />
                ) : (
                  <FileCode2 size={14} />
                )}
                <span>{path}</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          {error && (
            <p className="group-error" role="alert">
              {error}
            </p>
          )}
          <div className="group-dialog-actions">
            <span className="muted">
              Saved locally · Gitea review stays unchanged
            </span>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => void reviewGroup(inspect)}
            >
              {busy
                ? "Checking…"
                : inspect.paths.every((p) => progress.read[p] === revision)
                  ? "Mark group unviewed"
                  : `Mark ${inspect.paths.length} files viewed`}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
