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

type Row =
  | { type: "file"; file: ChangedFile; grouped: boolean }
  | { type: "group"; group: ChangeGroup }
  | { type: "label"; text: string };
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
    [error, setError] = useState("");
  useEffect(() => {
    setOpen(new Set());
    setInspect(null);
    setError("");
  }, [revision]);
  const rows = useMemo(() => {
    const matches = (f: ChangedFile) =>
      f.filename.toLowerCase().includes(filter.toLowerCase());
    if (plain || !groups.length)
      return files
        .filter(matches)
        .map((file) => ({ type: "file", file, grouped: false }) as Row);
    const result: Row[] = [],
      grouped = new Set(groups.flatMap((g) => g.paths)),
      byPath = new Map(files.map((f) => [f.filename, f]));
    for (const group of groups) {
      const members = group.paths
        .map((p) => byPath.get(p))
        .filter((f): f is ChangedFile => !!f && matches(f));
      if (!members.length) continue;
      result.push({ type: "group", group });
      if (open.has(group.id) || filter)
        result.push(
          ...members.map(
            (file) => ({ type: "file", file, grouped: true }) as Row,
          ),
        );
    }
    const normal = files.filter((f) => !grouped.has(f.filename) && matches(f));
    if (normal.length)
      result.push(
        { type: "label", text: `Individual changes · ${normal.length}` },
        ...normal.map(
          (file) => ({ type: "file", file, grouped: false }) as Row,
        ),
      );
    return result;
  }, [files, groups, filter, plain, open]);
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: (i) =>
      rows[i].type === "group" ? 77 : rows[i].type === "label" ? 33 : 49,
    overscan: 8,
    getItemKey: (i) =>
      rows[i].type === "file"
        ? rows[i].file.filename
        : rows[i].type === "group"
          ? rows[i].group.id
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
      virtual.scrollToIndex(index, { align: "auto" });
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
    virtual,
  ]);
  const reviewGroup = async (group: ChangeGroup) => {
    if (busy) return;
    setBusy(group.id);
    setError("");
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
      <div className="file-virtual" ref={parent}>
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
                  <small>{parts.join("/") || "Repository root"}</small>
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
            Codex suggests these files contain only this repeated change.
            Inspect any file, then mark the group viewed for this PR revision.
            Files with extra edits stay in Individual changes.
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
