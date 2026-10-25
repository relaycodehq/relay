import { useState } from "react";
import { UserRound } from "lucide-react";
import { errorMessage } from "../../../shared/error-message";
import type { GuestSuggestion } from "../../../shared/guest-share";
import { api } from "../../lib/api";
import { useGuestShare, useGuestSuggestions } from "./useGuestShare";
import "./guest-share.css";

/** A thread holds this many cards above its composer; the rest wait their turn. */
const SHOWN = 3;

/**
 * Above the composer of a shared thread: a quiet line saying guests can read
 * it, and what they suggested. Send runs one as a turn in the guest's name;
 * Edit puts it in the host's own draft first.
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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>();
  const send = async () => {
    setSending(true);
    try {
      await api.sendGuestSuggestion(suggestion.id);
    } catch (e) {
      setError(e);
      setSending(false);
    }
  };
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
      {!!error && (
        <p className="guest-suggestion-error">{errorMessage(error)}</p>
      )}
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
          title="Put it in your message to change it first"
          onClick={() => {
            onAdd(suggestion.text);
            void api.resolveGuestSuggestion(suggestion.id, "drafted");
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="primary"
          disabled={sending}
          title={`Runs it as a turn in ${suggestion.name}'s name`}
          onClick={() => void send()}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </footer>
    </section>
  );
}
