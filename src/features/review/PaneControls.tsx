import { Files, RefreshCw } from "lucide-react";
import { useShortcutLabel } from "../../lib/shortcuts";

export function PaneControls({
  filesHidden,
  onToggleFiles,
  onRefresh,
}: {
  filesHidden: boolean;
  onToggleFiles: () => void;
  /** Loads the PR afresh, for new commits and comments. */
  onRefresh: () => void;
}) {
  const filesKeys = useShortcutLabel("review-files");
  return (
    <div className="pane-controls" role="group" aria-label="Review panes">
      <button
        className="icon-button"
        aria-label="Refresh pull request"
        title="Refresh pull request"
        onClick={onRefresh}
      >
        <RefreshCw size={16} />
      </button>
      <button
        className={`icon-button ${filesHidden ? "" : "active"}`}
        aria-label="Toggle changed files"
        aria-controls="files-sidebar"
        aria-pressed={!filesHidden}
        title={`${filesHidden ? "Show" : "Hide"} changed files${filesKeys && ` · ${filesKeys}`}`}
        onClick={onToggleFiles}
      >
        <Files size={17} />
      </button>
    </div>
  );
}
