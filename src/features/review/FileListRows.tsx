import type { CSSProperties } from "react";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Info,
  Layers3,
} from "lucide-react";
import {
  diagnosticSummary,
  diagnosticSeverity,
  type ProjectCheckState,
} from "../../../shared/checks";
import type { ChangedFile } from "../../../shared/types";
import type { ChangeGroup } from "../../../shared/triage";

/** The Viewed section's header, folding what's been looked at already. */
export function ViewedFold({
  style,
  count,
  expanded,
  filtering,
  onToggle,
}: {
  style: CSSProperties;
  count: number;
  expanded: boolean;
  filtering: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="viewed-fold-row" style={style}>
      <button
        className="viewed-fold"
        aria-expanded={expanded}
        disabled={filtering}
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Viewed
        <span>{count}</span>
      </button>
    </div>
  );
}

/** A group of files with the same change, marked viewed together. */
export function GroupRow({
  style,
  group,
  viewed,
  expanded,
  busy,
  onToggle,
  onInspect,
  onReview,
}: {
  style: CSSProperties;
  group: ChangeGroup;
  /** How many of its files are viewed. */
  viewed: number;
  expanded: boolean;
  /** The group whose files are being marked, if any. */
  busy: string | null;
  onToggle: () => void;
  onInspect: () => void;
  onReview: () => void;
}) {
  const allViewed = viewed === group.paths.length;
  return (
    <div
      className={`change-group ${allViewed ? "is-viewed" : ""}`}
      style={style}
    >
      <div className="group-heading-row">
        <button
          className="group-heading"
          aria-expanded={expanded}
          title={group.description}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <strong>{group.name}</strong>
          <span>{group.paths.length}</span>
        </button>
        <button
          className="group-info icon-button"
          aria-label={`About ${group.name}`}
          title="Group description and files"
          disabled={!!busy}
          onClick={onInspect}
        >
          <Info size={15} />
        </button>
      </div>
      <div className="group-bottom">
        <span>
          {allViewed ? <CheckCheck size={12} /> : <Layers3 size={12} />}{" "}
          {viewed}/{group.paths.length} viewed
        </span>
        <button disabled={!!busy} onClick={onReview}>
          {reviewLabel(busy === group.id, allViewed)}
        </button>
      </div>
    </div>
  );
}

function reviewLabel(checking: boolean, allViewed: boolean) {
  if (checking) return "Checking…";
  return allViewed ? "Mark as unviewed" : "Mark as viewed";
}

function statusLetter(status: string) {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return "M";
  }
}

/** One changed file, with its checks' count and its Git status. */
export function FileRow({
  style,
  file: f,
  grouped,
  active,
  read,
  changed,
  checks,
  note,
  onSelect,
}: {
  style: CSSProperties;
  file: ChangedFile;
  /** Listed under its group. */
  grouped: boolean;
  active: boolean;
  read: boolean;
  /** Viewed before, and changed by a later push. */
  changed: boolean;
  checks?: ProjectCheckState | null;
  /** Why triage left it for individual review. */
  note?: string;
  onSelect: () => void;
}) {
  const parts = f.filename.split("/"),
    name = parts.pop(),
    checked = checks?.status === "ready" ? checks.files[f.filename] : undefined;
  return (
    <button
      className={`file-row ${grouped ? "group-member" : ""} ${active ? "active" : ""} ${read ? "read" : ""}`}
      style={style}
      title={note ? `${f.filename}\nIndividual review: ${note}` : f.filename}
      onClick={onSelect}
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
        {statusLetter(f.status)}
      </span>
    </button>
  );
}
