import { Files, MessageSquare, RefreshCw } from "lucide-react";
import { useShortcutLabel } from "../lib/shortcuts";

export function PaneControls({
  filesHidden,
  onToggleFiles,
  onRefresh,
  roomOpen,
  onToggleRoom,
}: {
  filesHidden: boolean;
  onToggleFiles: () => void;
  /** Loads the PR afresh, for new commits and comments. */
  onRefresh: () => void;
  roomOpen: boolean;
  onToggleRoom?: () => void;
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
      {onToggleRoom && (
        <button
          className={`icon-button ${roomOpen ? "active" : ""}`}
          aria-label="Toggle PR room"
          aria-controls="pr-room"
          aria-pressed={roomOpen}
          title={`${roomOpen ? "Hide" : "Show"} PR room`}
          onClick={onToggleRoom}
        >
          <MessageSquare size={17} />
        </button>
      )}
    </div>
  );
}
