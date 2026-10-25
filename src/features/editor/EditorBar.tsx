import type { ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import { Diff, X } from "lucide-react";
import type { DocumentStatus } from "./documents";
import { EditorPath } from "../../ui/EditorPath";
import { IconButton } from "../../ui/ui";
import { DiskState, EditHistory, ReloadButton, saveState } from "./controls";

/** The inline editor's bar: its path and state, then its controls. */
export function EditorBar({
  lead,
  path,
  title,
  status,
  view,
  modes,
  servers,
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
  view: () => EditorView | undefined;
  /** How a Markdown file shows: code, preview or both. */
  modes?: ReactNode;
  /** Where the language servers stand, as muted text. */
  servers?: ReactNode;
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
      {baseline && (
        <span className="editor-bar-baseline">
          Changes since {baseline.label}
          <IconButton label={`Show changes since ${base} instead`} onClick={baseline.onDrop}>
            <X size={13} />
          </IconButton>
        </span>
      )}
      <span className="divider" />
      {modes}
      <EditHistory size={15} view={view} />
      <span className="editor-bar-actions">
        <ReloadButton size={15} status={status} onReload={onReload} />
        {actions}
      </span>
      {onCompare && (
        <IconButton
          label={`Show changes since ${base}`}
          active={compare}
          onClick={onCompare}
        >
          <Diff size={15} />
        </IconButton>
      )}
      <button
        className="primary"
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
