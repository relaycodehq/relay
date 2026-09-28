import { Files, MessageSquare, PanelLeft } from "lucide-react";
import { keys } from "../lib/mod-key";

export function PaneControls({
  requestsHidden,
  filesHidden,
  onToggleRequests,
  onToggleFiles,
  roomOpen,
  onToggleRoom,
}: {
  requestsHidden: boolean;
  filesHidden: boolean;
  onToggleRequests: () => void;
  onToggleFiles: () => void;
  roomOpen: boolean;
  onToggleRoom?: () => void;
}) {
  return (
    <div className="pane-controls" role="group" aria-label="Sidebar visibility">
      <button
        className={`icon-button ${requestsHidden ? "" : "active"}`}
        aria-label="Toggle pull requests"
        aria-controls="requests-sidebar"
        aria-pressed={!requestsHidden}
        title={`${requestsHidden ? "Show" : "Hide"} pull requests · ${keys("⌘⇧B", "Ctrl+Shift+B")}`}
        onClick={onToggleRequests}
      >
        <PanelLeft size={17} />
      </button>
      <button
        className={`icon-button ${filesHidden ? "" : "active"}`}
        aria-label="Toggle changed files"
        aria-controls="files-sidebar"
        aria-pressed={!filesHidden}
        title={`${filesHidden ? "Show" : "Hide"} changed files · ${keys("⌘B", "Ctrl+B")}`}
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
