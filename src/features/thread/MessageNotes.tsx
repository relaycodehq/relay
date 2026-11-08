import { Fragment, memo, type ReactNode } from "react";
import { Check } from "lucide-react";
import { LineDivider } from "../../ui/LineDivider";
import type { ChatMessage, ChatSummary } from "../../../shared/projects";
import {
  shownWorkspaceMoves,
  workspaceMoveLine,
} from "../../../shared/workspace-moves";
import { terminalOriginNote } from "../continue-session/TerminalOrigin";
import { ranHereNote } from "./HeldSends";
import { renamedNote } from "./WorktreeControls";

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
 * would stack. Memoized: a thread has one under every message, and a streamed
 * piece changes none of theirs.
 */
export const MessageNotes = memo(function MessageNotes({
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
});

/** The same empty list under every message with nothing to say, so its
 * memoized notes line skips each streamed piece. */
export const NO_NOTES: MessageNote[] = [];

/** What happened under `m`, said on one line. */
export function notesUnderMessage(
  m: ChatMessage,
  chat: ChatSummary,
  {
    renamedAfter,
    moves,
    landed,
    last,
  }: {
    renamedAfter: string | undefined;
    moves: ReturnType<typeof shownWorkspaceMoves>;
    landed: MessageNote | undefined | false | null;
    last: ChatMessage | undefined;
  },
): MessageNote[] {
  const notes = [
    ...(m.id === chat.fromTerminal?.through
      ? [{ key: "terminal-origin", ...terminalOriginNote(chat.fromTerminal) }]
      : []),
    ...(m.id === renamedAfter && chat.worktree
      ? [renamedNote(chat.worktree)]
      : []),
    ...moves
      .filter((move) => move.after === m.id)
      .map((move) => ({
        key: `workspace-move-${move.at}`,
        text: workspaceMoveLine(move),
        title: move.to,
      })),
    ...(chat.abandonedHandoffs ?? [])
      .filter((a) => a.ranHere?.after === m.id)
      .map((a) => ({
        key: `ran-here-${a.id}`,
        text: ranHereNote(a.computer, a.ranHere!.since),
      })),
    ...(m.id === last?.id ? [landed] : []),
  ].filter((note): note is MessageNote => !!note);
  return notes.length ? notes : NO_NOTES;
}
