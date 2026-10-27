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
  const [stopError, setStopError] = useState<unknown>();
  if (!share && !suggestions.length) return null;
  const more = suggestions.length - SHOWN;
  const stop = async () => {
    setStopError(undefined);
    try {
      await api.stopGuestShare(threadId);
    } catch (e) {
      // The link may still come back after a restart: say so, and keep the button.
      setStopError(e);
    }
  };
  return (
    <div className="guest-suggestions">
      {!!suggestions.length && (
        <div className="guest-suggestion-stack">
          {suggestions.slice(0, SHOWN).map((s) => (
            <SuggestionCard key={s.id} suggestion={s} onAdd={onAdd} />
          ))}
        </div>
      )}
      {more > 0 && (
        <p className="guest-suggestions-more">{more} more waiting</p>
      )}
      {share && (
        <p className="guest-share-live">
          Guests can read this thread.
          <button type="button" onClick={() => void stop()}>
            Stop sharing
          </button>
        </p>
      )}
      {!!stopError && (
        <p className="guest-suggestion-error">{errorMessage(stopError)}</p>
      )}
    </div>
  );
}

type Answer = "send" | "drafted" | "dismissed";

function SuggestionCard({
  suggestion,
  onAdd,
}: {
  suggestion: GuestSuggestion;
  onAdd: (text: string) => void;
}) {
  // One answer at a time: Edit while Send is on its way would draft words already sent.
  const [answering, setAnswering] = useState<Answer>();
  const [error, setError] = useState<unknown>();
  // On success the card goes away with the suggestions event.
  const answer = async (how: Answer) => {
    setAnswering(how);
    setError(undefined);
    try {
      if (how === "send") await api.sendGuestSuggestion(suggestion.id);
      else await api.resolveGuestSuggestion(suggestion.id, how);
      if (how === "drafted") onAdd(suggestion.text);
    } catch (e) {
      setError(e);
      setAnswering(undefined);
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
          disabled={!!answering}
          onClick={() => void answer("dismissed")}
        >
          Dismiss
        </button>
        <button
          type="button"
          disabled={!!answering}
          title="Put it in your message to change it first"
          onClick={() => void answer("drafted")}
        >
          Edit
        </button>
        <button
          type="button"
          className="primary"
          disabled={!!answering}
          title={`Runs it as a turn in ${suggestion.name}'s name`}
          onClick={() => void answer("send")}
        >
          {answering === "send" ? "Sending…" : "Send"}
        </button>
      </footer>
    </section>
  );
}
