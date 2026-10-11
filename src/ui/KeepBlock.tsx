// A pin beside a list, code block or table in an answer, keeping its
// markdown in the thread's notes, and one under the answer pinning it whole.
// Only a thread that keeps notes provides them.
import { createContext, useContext } from "react";
import { Pin } from "lucide-react";

export interface Keeper {
  /** Keeps `markdown`, from the message holding `at`. */
  keep: (markdown: string, at: Element) => void;
  kept: (markdown: string) => boolean;
  /** Pins message `id` whole, or unpins it. */
  togglePin: (id: string) => void;
  pinned: (id: string) => boolean;
}

export const KeepBlock = createContext<Keeper | null>(null);

export function KeepBlockButton({
  source,
  className,
}: {
  /** The block's markdown, as the answer has it. */
  source: string;
  className: string;
}) {
  const keeper = useContext(KeepBlock);
  if (!keeper || !source.trim()) return null;
  const kept = keeper.kept(source);
  return (
    <button
      type="button"
      className={className}
      aria-pressed={kept}
      title={kept ? "Kept in notes" : "Keep in notes"}
      aria-label={kept ? "Kept in notes" : "Keep in notes"}
      onClick={(e) => {
        if (!kept) keeper.keep(source, e.currentTarget);
      }}
    >
      <Pin size={13} />
    </button>
  );
}

/** A pin keeping a whole message in the notes as a pointer back to it. */
export function PinMessageButton({ id }: { id: string }) {
  const keeper = useContext(KeepBlock);
  if (!keeper) return null;
  const pinned = keeper.pinned(id);
  const label = pinned ? "Unpin from notes" : "Pin to notes";
  return (
    <button
      type="button"
      className="message-pin"
      aria-pressed={pinned}
      title={label}
      aria-label={label}
      onClick={() => keeper.togglePin(id)}
    >
      <Pin size={15} />
    </button>
  );
}
