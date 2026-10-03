import type { SelectedLineRange } from "@pierre/diffs";
import { Bookmark, MessageSquare, Pencil, Terminal, X } from "lucide-react";
import type { QuestionTarget } from "../../../../shared/questions";
import type { Side } from "../../../../shared/types";
import { selectedSpan } from "../diff-selection";
import { IconButton } from "../../../ui/ui";

/** What can be done with the lines selected in a PR file's diff. */
export function SelectionToolbar({
  range,
  path,
  questionAgent,
  onAskAboutLines,
  onDiscuss,
  onComment,
  onEditLine,
  onMark,
  onClear,
  onError,
}: {
  range: SelectedLineRange;
  path: string;
  questionAgent: string;
  onAskAboutLines: (target: QuestionTarget) => void;
  onDiscuss: (target: QuestionTarget) => void;
  onComment: () => void;
  onEditLine: (line: number) => void;
  onMark: (start: number, end: number, side: Side) => void;
  onClear: () => void;
  onError: (e: unknown) => void;
}) {
  return (
    <div className="selection-toolbar">
      <span>
        {range.side === "deletions" ? "Base" : "Head"} ·{" "}
        {range.start === range.end
          ? `line ${range.start}`
          : `lines ${range.start}–${range.end}`}
      </span>
      <button
        onClick={() => {
          const span = selectedSpan(range);
          if ("error" in span) {
            onError(
              new Error(
                span.error === "two-sides"
                  ? `Select lines on one side to ask ${questionAgent}.`
                  : `Select up to 200 lines to ask ${questionAgent}.`,
              ),
            );
            return;
          }
          onAskAboutLines({ path, ...span });
        }}
      >
        <Terminal size={13} /> Ask {questionAgent}
      </button>
      <button
        onClick={() => {
          const span = selectedSpan(range);
          if ("error" in span) {
            onError(
              new Error("Select up to 200 lines on one side to discuss."),
            );
            return;
          }
          onDiscuss({ path, ...span });
        }}
      >
        <MessageSquare size={13} />
        Discuss in room
      </button>
      <button onClick={onComment}>
        <MessageSquare size={13} />
        Comment
      </button>
      {range.side !== "deletions" && range.endSide !== "deletions" && (
        <button
          aria-label="Edit selected line locally"
          onClick={() => onEditLine(range.start)}
        >
          <Pencil size={13} /> Edit locally
        </button>
      )}
      <button
        onClick={() => {
          if (range.endSide && range.endSide !== range.side) {
            onError(new Error("Select a range on one side to mark it."));
            return;
          }
          onMark(
            Math.min(range.start, range.end),
            Math.max(range.start, range.end),
            range.side ?? "additions",
          );
        }}
      >
        <Bookmark size={13} />
        Mark for later
      </button>
      <IconButton label="Clear selected lines" onClick={onClear}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
