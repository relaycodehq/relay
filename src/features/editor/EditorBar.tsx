import type { ReactNode } from "react";
import { Diff, X } from "lucide-react";
import type { DocumentStatus } from "./documents";
import { EditorPath } from "../../ui/EditorPath";
import { IconButton } from "../../ui/ui";
import { DiskState, saveState } from "./controls";

/**
 * The inline editor's status line, under the code: the file, what reads it
 * and what checks found, then what its changes show against and Save.
 */
export function EditorBar({
  lead,
  path,
  title,
  status,
  modes,
  servers,
  checks,
  actions,
  base,
  compare,
  onCompare,
  baseline,
  saveKeys,
  onSave,
  onReload,
}: {
  /** Before the path, like the file list's toggle. */
  lead?: ReactNode;
  path: string;
  /** The path on hover, when the bar's path isn't the whole story. */
  title?: string;
  status: DocumentStatus;
  /** How a Markdown file shows: code, preview or both. */
  modes?: ReactNode;
  /** Where the language servers stand, as muted text. */
  servers?: ReactNode;
  /** Where the project's checks stand on this file. */
  checks?: ReactNode;
  actions?: ReactNode;
  base: string;
  compare: boolean;
  /** Absent for a folder without Git, or while the changes show against a baseline. */
  onCompare?: () => void;
  /** What the changes show against instead of `base`, and dropping it to go back to `base`. */
  baseline?: { label: string; onDrop: () => void };
  saveKeys: string;
  onSave: () => void;
  onReload: () => void;
}) {
  return (
    <div className="editor-bar">
      {lead}
      <EditorPath path={path} title={title ?? path}>
        <DiskState
          status={status}
          onReload={onReload}
          className={`editor-bar-state ${status.dirty ? "dirty" : ""}`}
        >
          {saveState(status)}
        </DiskState>
      </EditorPath>
      {servers}
      {checks}
      <span className="editor-bar-gap" />
      {baseline && (
        <span className="editor-bar-baseline">
          Changes since {baseline.label}
          <IconButton label={`Show changes since ${base} instead`} onClick={baseline.onDrop}>
            <X size={12} />
          </IconButton>
        </span>
      )}
      {modes}
      {onCompare && (
        <IconButton
          label={`Show changes since ${base}`}
          active={compare}
          onClick={onCompare}
        >
          <Diff size={14} />
        </IconButton>
      )}
      <span className="editor-bar-actions">{actions}</span>
      <button
        type="button"
        className="editor-save"
        aria-label="Save locally"
        title={`Save to the local folder${saveKeys && ` (${saveKeys})`}`}
        disabled={!status.dirty || status.saving || status.loading}
        onClick={onSave}
      >
        Save
      </button>
    </div>
  );
}
