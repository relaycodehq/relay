import type { Ref } from "react";
import { FileCode2, GitBranch, MessageSquare } from "lucide-react";
import type { Pull } from "../../shared/types";

export type ReviewTab = "files" | "conversation" | "local";

/** The review's tabs, and how many of its files are viewed. */
export function ReviewTabs({
  pull,
  tab,
  onTab,
  readCount,
  ref,
}: {
  pull: Pull;
  tab: ReviewTab;
  onTab: (tab: ReviewTab) => void;
  readCount: number;
  /** Measures the pane, which decides whether a split diff fits. */
  ref: Ref<HTMLDivElement>;
}) {
  return (
    <div className="review-tabs" ref={ref}>
      <div className="tab-buttons">
        <button
          className={tab === "files" ? "active" : ""}
          onClick={() => onTab("files")}
        >
          <FileCode2 size={15} />
          Files changed<span>{pull.changed_files}</span>
        </button>
        <button
          className={tab === "conversation" ? "active" : ""}
          onClick={() => onTab("conversation")}
        >
          <MessageSquare size={15} />
          Conversation
        </button>
        <button
          className={tab === "local" ? "active" : ""}
          onClick={() => onTab("local")}
        >
          <GitBranch size={15} />
          Local changes
        </button>
      </div>
      <div className="review-progress">
        <span>
          {readCount} of {pull.changed_files} reviewed
        </span>
        <div>
          <i
            style={{
              width: `${pull.changed_files ? (readCount / pull.changed_files) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
