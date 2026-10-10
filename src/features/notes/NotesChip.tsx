// The thread's notes beside the composer: a pin with how many are kept, and
// a card holding them. Lists tick off; any note can go into the draft or
// take you back to where it was kept.
import { useMemo, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowUpToLine,
  Check,
  GripVertical,
  Pin,
  TextQuote,
  X,
} from "lucide-react";
import { agentName } from "../../../shared/agents";
import {
  noteList,
  noteQuote,
  type ThreadNote,
} from "../../../shared/thread-notes";
import { useDragSort, type DragDrop } from "../../lib/useDragSort";
import { RichText } from "../../ui/RichText";
import type { ThreadNotesHandle } from "./useThreadNotes";
import "./notes.css";

export function NotesChip({
  notes,
  onQuote,
  onJump,
}: {
  notes: ThreadNotesHandle;
  /** Puts text in the composer as a quote. */
  onQuote: (text: string) => void;
  /** Brings message `id` into view; absent when it isn't in the thread. */
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!notes.notes.length) return null;
  const count = notes.notes.length;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={250}
        className="composer-branch-trigger notes-chip"
        aria-label={`${count} ${count === 1 ? "note" : "notes"}`}
      >
        <Pin size={13} />
        <span>{count}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup className="notes-card" aria-label="Notes">
            <div className="notes-card-head">
              <b>Notes</b>
              <span>Select text or hover a list, code or table to keep it</span>
            </div>
            <div className="notes-card-list">
              {notes.notes.map((note) => (
                <Note
                  key={note.id}
                  note={note}
                  notes={notes}
                  onQuote={(text) => {
                    setOpen(false);
                    onQuote(text);
                  }}
                  onJump={
                    note.from
                      ? () => {
                          setOpen(false);
                          onJump(note.from!);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Note({
  note,
  notes,
  onQuote,
  onJump,
}: {
  note: ThreadNote;
  notes: ThreadNotesHandle;
  onQuote: (text: string) => void;
  onJump?: () => void;
}) {
  const list = useMemo(() => noteList(note.text), [note.text]);
  const items = list?.items ?? [];
  // Text in the id, so the rows settle once the moved list renders.
  const ids = items.map((item, index) => `${index}:${item.text}`);
  const sort = useDragSort(
    ids,
    items.length > 1,
    (id, target) =>
      notes.arrange(
        note.id,
        moved(items.length, ids.indexOf(id), ids.indexOf(target.id), target),
      ),
    ".notes-grip",
  );
  const order = items.map((_, index) => index + 1);
  const done = new Set(note.done);
  const quote = noteQuote(note);
  const remaining = list?.items.filter((_, index) => !done.has(index)).length;
  const quoteLabel = !quote
    ? "All done — uncheck an item to quote it"
    : list && remaining !== list.items.length
      ? "Quote remaining items in your message"
      : "Quote it in your message";
  const tools = (
    <div className="notes-note-tools">
      {onJump && (
        <button
          type="button"
          title="Show where it was kept"
          aria-label="Show where it was kept"
          onClick={onJump}
        >
          <ArrowUpToLine size={13} />
        </button>
      )}
      <button
        type="button"
        title={quoteLabel}
        aria-label={quoteLabel}
        disabled={!quote}
        onClick={() => {
          if (quote) onQuote(quote);
        }}
      >
        <TextQuote size={13} />
      </button>
      <button
        type="button"
        title="Remove"
        aria-label="Remove note"
        onClick={() => notes.remove(note.id)}
      >
        <X size={13} />
      </button>
    </div>
  );
  return (
    <section className="notes-note">
      {!list && tools}
      {list ? (
        <>
          {list.lead && (
            <div className="notes-lead">
              <RichText text={list.lead} />
            </div>
          )}
          <ol
            className="notes-items"
            ref={sort.list}
            onPointerDown={sort.onPointerDown}
          >
            {list.items.map((item, index) => (
              <li key={index} className={done.has(index) ? "done" : undefined}>
                <span
                  className="notes-grip"
                  title="Drag to reorder"
                  aria-hidden="true"
                >
                  <GripVertical size={12} />
                </span>
                <button
                  type="button"
                  className="notes-tick"
                  role="checkbox"
                  aria-checked={done.has(index)}
                  aria-label={done.has(index) ? "Mark not done" : "Mark done"}
                  onClick={() =>
                    notes.tick(note.id, index + 1, !done.has(index))
                  }
                >
                  {done.has(index) && <Check size={10} strokeWidth={3} />}
                </button>
                {item.number && <span className="notes-n">{item.number}</span>}
                <div className="notes-text">
                  <RichText text={item.text} />
                </div>
                <button
                  type="button"
                  className="notes-ask"
                  title={
                    done.has(index)
                      ? "Uncheck this item to quote it"
                      : "Quote this item in your message"
                  }
                  disabled={done.has(index)}
                  onClick={() => {
                    const text = noteQuote(note, index);
                    if (text) onQuote(text);
                  }}
                >
                  <TextQuote size={12} />
                  Ask
                </button>
                <button
                  type="button"
                  className="notes-drop"
                  title="Remove this item"
                  aria-label="Remove this item"
                  onClick={() =>
                    notes.arrange(
                      note.id,
                      order.filter((item) => item !== index + 1),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ol>
          {/* Below the items, where they can't cover an item's own buttons. */}
          <div className="notes-foot">
            <span className="notes-progress" role="status">
              {remaining
                ? `${remaining} of ${list.items.length} remaining`
                : "All done"}
            </span>
            {tools}
          </div>
        </>
      ) : (
        <div className="notes-body">
          <RichText text={note.text} />
        </div>
      )}
      {note.by && <div className="notes-by">Kept by {agentName(note.by)}</div>}
    </section>
  );
}

/** The items, from 1, after item `from` (from 0) is dropped by item `to`. */
function moved(count: number, from: number, to: number, target: DragDrop) {
  const order = [...Array(count).keys()].filter((index) => index !== from);
  order.splice(
    order.indexOf(to) + (target.where === "after" ? 1 : 0),
    0,
    from,
  );
  return order.map((index) => index + 1);
}
