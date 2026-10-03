import {
  Check,
  FileCode2,
  Pencil,
  UnfoldVertical,
  WrapText,
} from "lucide-react";
import type { ChangedFile } from "../../../shared/types";
import { IconButton } from "../../ui/ui";

/** The file under review and how its diff shows, with its Viewed toggle. */
export function FileToolbar({
  files,
  file,
  layout,
  narrow,
  fullContext,
  wrap,
  read,
  changedSinceViewed,
  ready,
  onSelectFile,
  onEditFile,
  onSplit,
  onFullContext,
  onWrap,
  onToggleRead,
}: {
  files: ChangedFile[];
  file?: ChangedFile;
  layout: "split" | "unified";
  /** Too narrow for a side-by-side diff. */
  narrow: boolean;
  fullContext: boolean;
  wrap: boolean;
  /** The file is viewed at this revision. */
  read: boolean;
  changedSinceViewed: Set<string>;
  /** Progress has loaded, so the file can be marked. */
  ready: boolean;
  onSelectFile: (path: string) => void;
  onEditFile: (path: string) => void;
  onSplit: (split: boolean) => void;
  onFullContext: () => void;
  onWrap: () => void;
  onToggleRead: () => void;
}) {
  return (
    <div className="file-toolbar">
      <div className="file-name">
        <FileCode2 size={15} />
        <select
          aria-label="Current file"
          value={file?.filename ?? ""}
          onChange={(e) => onSelectFile(e.target.value)}
        >
          {files.map((f) => (
            <option key={f.filename} value={f.filename}>
              {f.filename}
            </option>
          ))}
        </select>
      </div>
      <div className="toolbar-actions">
        <button
          className="edit-file-button"
          disabled={!file || file.status === "deleted"}
          onClick={() => file && onEditFile(file.filename)}
          title="Edit this file in the linked local checkout"
        >
          <Pencil size={14} /> Edit locally
        </button>
        <div className="segmented diff-toggle">
          <button
            aria-label="Side by side diff"
            className={layout === "split" ? "active" : ""}
            disabled={narrow}
            title={
              narrow ? "Widen this pane for a side-by-side diff" : undefined
            }
            onClick={() => onSplit(true)}
          >
            Split
          </button>
          <button
            aria-label="Unified diff"
            className={layout === "unified" ? "active" : ""}
            onClick={() => onSplit(false)}
          >
            Unified
          </button>
        </div>
        <IconButton
          label="Show unchanged lines"
          active={fullContext}
          onClick={onFullContext}
        >
          <UnfoldVertical size={16} />
        </IconButton>
        <IconButton label="Wrap long lines" active={wrap} onClick={onWrap}>
          <WrapText size={16} />
        </IconButton>
        {file && !read && changedSinceViewed.has(file.filename) && (
          <span className="read-changed">Changed since viewed</span>
        )}
        <button
          className={`read-button ${read ? "is-read" : ""}`}
          onClick={onToggleRead}
          disabled={!file || !ready}
        >
          <span className="checkbox">{read && <Check size={11} />}</span>
          Viewed<kbd>V</kbd>
        </button>
      </div>
    </div>
  );
}
