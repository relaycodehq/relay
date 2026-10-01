import {
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  MessageSquare,
} from "lucide-react";
import { IconButton } from "./ui";

/** Whether progress is saved, the drafts, stepping through files, and the linked checkout. */
export function DiffFooter({
  saveState,
  saveFailed,
  draftCount,
  index,
  total,
  count,
  linked,
  onRetrySave,
  onDrafts,
  onMove,
  onFolder,
}: {
  saveState: string;
  saveFailed: boolean;
  draftCount: number;
  /** The file's place in the review's order. */
  index: number;
  /** How many files the PR changes. */
  total: number;
  /** How many of them are loaded. */
  count: number;
  linked: boolean;
  onRetrySave: () => void;
  onDrafts: () => void;
  onMove: (n: number) => void;
  onFolder: () => void;
}) {
  return (
    <footer className="diff-footer">
      <div className="footer-left">
        <button className={saveFailed ? "deletions" : ""} onClick={onRetrySave}>
          <span className={`dot ${saveFailed ? "red" : "green"}`} />
          {saveState}
        </button>
        <span>·</span>
        <button onClick={onDrafts}>
          <MessageSquare size={12} />
          {draftCount} draft{draftCount !== 1 ? "s" : ""}
        </button>
      </div>
      <div className="footer-right">
        <span>
          {index + 1} / {total}
        </span>
        <IconButton
          label="Previous file · K"
          disabled={index <= 0}
          onClick={() => onMove(-1)}
        >
          <ChevronLeft size={15} />
        </IconButton>
        <IconButton
          label="Next file · J"
          disabled={index >= count - 1}
          onClick={() => onMove(1)}
        >
          <ChevronRight size={15} />
        </IconButton>
        <button className={linked ? "linked-folder" : ""} onClick={onFolder}>
          <FolderGit2 size={14} />
          {linked ? "Repository linked" : "Link local folder"}
        </button>
      </div>
    </footer>
  );
}
