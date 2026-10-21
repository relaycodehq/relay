import { useCallback, useState } from "react";
import { api } from "../../lib/api";

/** An answer's guess at the next message; `id` is the answer's, `seen` once the composer showed it. */
export type NextGuess = { id: string; text: string; seen?: boolean };

const noted = (e: unknown) => console.warn("Could not note the guess:", e);

/**
 * The guess the composer offers over an empty draft. `seen` tells Relay once
 * it is on screen, so only what was sent after a guess someone saw counts
 * for or against guessing; Escape puts it away for good, on every window.
 */
export function useNextGuess(
  chatId: string | undefined,
  guess: NextGuess | undefined,
  /** The draft is empty and goes to an agent. */
  wanted: boolean,
) {
  // Hidden at once, before the answer comes back marked.
  const [dismissed, setDismissed] = useState<string>();
  const shown = guess && guess.id !== dismissed && wanted ? guess : undefined;
  const id = shown?.id;
  const seen = shown?.seen;
  const onScreen = useCallback(() => {
    if (chatId && id && !seen)
      api.seePrediction(chatId, id, "shown").catch(noted);
  }, [chatId, id, seen]);
  return {
    text: shown?.text,
    seen: onScreen,
    dismiss() {
      if (!shown) return;
      setDismissed(shown.id);
      if (chatId) api.seePrediction(chatId, shown.id, "dismissed").catch(noted);
    },
  };
}
