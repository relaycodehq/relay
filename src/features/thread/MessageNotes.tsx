import { Fragment, type ReactNode } from "react";
import { Check } from "lucide-react";
import { LineDivider } from "../../ui/LineDivider";

export type MessageNote = {
  key: string;
  text: string;
  title?: string;
  /** The worktree's branch landed; its note leads with the merged check. */
  landed?: true;
};

/**
 * Everything worth saying under one message, on one line: where the thread
 * moved, its renamed or landed branch, where it came from. Separate lines
 * would stack.
 */
export function MessageNotes({
  notes,
  unread,
}: {
  notes: MessageNote[];
  /** The unread mark, when the unseen part starts right below. */
  unread?: ReactNode;
}) {
  if (!notes.length) return null;
  return (
    <LineDivider role="note" className="message-notes">
      {unread}
      <span>
        {notes.map((note, i) => (
          <Fragment key={note.key}>
            {i > 0 && <span aria-hidden> · </span>}
            <span
              title={note.title}
              className={note.landed ? "message-note-landed" : undefined}
            >
              {note.landed && <Check size={12} />}
              {note.text}
            </span>
          </Fragment>
        ))}
      </span>
    </LineDivider>
  );
}
