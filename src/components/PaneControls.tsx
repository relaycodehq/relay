import { Files, PanelLeft } from "lucide-react";

export function PaneControls({
  requestsHidden,
  filesHidden,
  onToggleRequests,
  onToggleFiles,
}: {
  requestsHidden: boolean;
  filesHidden: boolean;
  onToggleRequests: () => void;
  onToggleFiles: () => void;
}) {
  return (
    <div className="pane-controls" role="group" aria-label="Sidebar visibility">
      <button
        className={`icon-button ${requestsHidden ? "" : "active"}`}
        aria-label="Toggle pull requests"
        aria-controls="requests-sidebar"
        aria-pressed={!requestsHidden}
        title={`${requestsHidden ? "Show" : "Hide"} pull requests · ⌘ / Ctrl Shift B`}
        onClick={onToggleRequests}
      >
        <PanelLeft size={17} />
      </button>
      <button
        className={`icon-button ${filesHidden ? "" : "active"}`}
        aria-label="Toggle changed files"
        aria-controls="files-sidebar"
        aria-pressed={!filesHidden}
        title={`${filesHidden ? "Show" : "Hide"} changed files · ⌘ / Ctrl B`}
        onClick={onToggleFiles}
      >
        <Files size={17} />
      </button>
    </div>
  );
}
