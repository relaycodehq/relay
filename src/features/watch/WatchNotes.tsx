import { useState } from "react";
import { Eye, X } from "lucide-react";
import type { WatchNote } from "../../../shared/watch";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { api } from "../../lib/api";
import { RichText } from "../../ui/RichText";
import "./watch-notes.css";

/**
 * What the side check flagged in this turn, after the answer and before its changes.
 * Closing one, in any of the three ways, keeps it out of the turn.
 */
export function WatchNotes({
  chatId,
  messageId,
  notes,
  projectRoot,
  onOpenFile,
  onSteer,
  agent,
}: {
  /** Who "Tell" puts the message in front of: Claude or Codex. */
  agent: string;
  chatId: string;
  messageId: string;
  notes: WatchNote[] | undefined;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  /** Puts a message for the agent in the composer. */
  onSteer: (text: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // Hidden at once; the saved message catches up when the close lands.
  const [closed, setClosed] = useState<string[]>([]);
  const shown = notes?.filter((n) => !n.closed && !closed.includes(n.id));
  if (!chatId || !shown?.length) return null;
  const close = (note: WatchNote, known = false) => {
    setClosed((all) => [...all, note.id]);
    void api.closeWatchNote(chatId, messageId, note.id, known).catch(() => {
      setClosed((all) => all.filter((id) => id !== note.id));
    });
  };
  return shown.map((note) => (
    <aside key={note.id} className="watch-note" aria-label={note.tag}>
      <header>
        <Eye size={13} aria-hidden />
        <span className="watch-note-tag">{note.tag}</span>
        <span className="watch-note-source">
          {note.agent ? `subagent \u00b7 ${note.agent.label}` : "this turn"}
        </span>
        <button
          type="button"
          className="watch-note-close"
          aria-label="Dismiss"
          onClick={() => close(note)}
        >
          <X size={13} />
        </button>
      </header>
      <p className="watch-note-line">{note.line}</p>
      {open === note.id && (
        <div className="watch-note-explain">
          <p className="watch-note-title">{note.title}</p>
          {!!note.points.length && (
            <RichText
              text={note.points.map((point) => `- ${point}`).join("\n")}
              projectRoot={projectRoot}
              onOpenFile={onOpenFile}
            />
          )}
          {note.diff && (
            <figure className="watch-note-diff">
              <figcaption>{note.diff.file}</figcaption>
              {note.diff.lines.map((line, i) => (
                <code key={i} data-sign={line[0]}>
                  {line}
                </code>
              ))}
            </figure>
          )}
        </div>
      )}
      <div className="watch-note-actions">
        <button
          type="button"
          aria-expanded={open === note.id}
          onClick={() => setOpen(open === note.id ? null : note.id)}
        >
          {open === note.id ? "Less" : "Learn more"}
        </button>
        <button
          type="button"
          onClick={() => {
            onSteer(note.steer ?? `About this: ${note.line}`);
            close(note);
          }}
        >
          Tell {agent}
        </button>
        <button type="button" onClick={() => close(note, true)}>
          I know this
        </button>
      </div>
    </aside>
  ));
}
