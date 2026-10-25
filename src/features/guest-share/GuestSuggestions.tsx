import { UserRound } from "lucide-react";
import type { GuestSuggestion } from "../../../shared/guest-share";
import { api } from "../../lib/api";
import { useGuestShare, useGuestSuggestions } from "./useGuestShare";
import "./guest-share.css";

/** A thread holds this many cards above its composer; the rest wait their turn. */
const SHOWN = 3;

/**
 * Above the composer of a shared thread: a quiet line saying guests can read
 * it, and what they suggested. Edit puts one in the host's own draft, so
 * it's still the host who sends it.
 */
export function GuestSuggestions({
  threadId,
  onAdd,
}: {
  threadId: string;
  /** Puts the text into the thread's draft. */
  onAdd: (text: string) => void;
}) {
  const share = useGuestShare(threadId).data;
  const suggestions = useGuestSuggestions(threadId).data ?? [];
  if (!share && !suggestions.length) return null;
  const more = suggestions.length - SHOWN;
  return (
    <div className="guest-suggestions">
      {suggestions.slice(0, SHOWN).map((s) => (
        <SuggestionCard key={s.id} suggestion={s} onAdd={onAdd} />
      ))}
      {more > 0 && (
        <p className="guest-suggestions-more">{more} more waiting</p>
      )}
      {share && (
        <p className="guest-share-live">
          Guests can read this thread.
          <button
            type="button"
            onClick={() => void api.stopGuestShare(threadId)}
          >
            Stop sharing
          </button>
        </p>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onAdd,
}: {
  suggestion: GuestSuggestion;
  onAdd: (text: string) => void;
}) {
  return (
    <section
      className="guest-suggestion"
      aria-label={`Suggestion from ${suggestion.name}`}
    >
      <header>
        <UserRound size={14} />
        <span>{suggestion.name} suggests</span>
      </header>
      <p className="guest-suggestion-text">{suggestion.text}</p>
      <footer>
        <button
          type="button"
          onClick={() =>
            void api.resolveGuestSuggestion(suggestion.id, "dismissed")
          }
        >
          Dismiss
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            onAdd(suggestion.text);
            void api.resolveGuestSuggestion(suggestion.id, "drafted");
          }}
        >
          Add to message
        </button>
      </footer>
    </section>
  );
}
