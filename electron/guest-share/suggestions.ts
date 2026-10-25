import { randomUUID } from "node:crypto";
import type { GuestSuggestion } from "../../shared/guest-share";
import type { SavedGuestShare } from "../app/store-types";

export type SavedSuggestion = SavedGuestShare["suggestions"][number];

/** A guest may have this many suggestions waiting at once, per thread. */
export const WAITING_PER_GUEST = 5;
/** And a thread this many from all its guests. */
export const WAITING_PER_THREAD = 30;
/** Answered ones are kept this long, so their guests see what became of them. */
const ANSWERED_KEPT = 40;

/** Why a guest can't add another suggestion now; undefined when they can. */
export function suggestionRefusal(list: SavedSuggestion[], guestId: string) {
  const waiting = list.filter((s) => s.status === "waiting");
  if (waiting.length >= WAITING_PER_THREAD)
    return "The host has a lot to read already. Try again later.";
  if (waiting.filter((s) => s.guestId === guestId).length >= WAITING_PER_GUEST)
    return "Wait for the host to get to your earlier suggestions.";
  return undefined;
}

export function withSuggestion(
  list: SavedSuggestion[],
  threadId: string,
  input: { guestId: string; name: string; text: string },
  at: number,
): SavedSuggestion[] {
  const answered = list.filter((s) => s.status !== "waiting");
  const dropped = new Set(
    answered.slice(0, Math.max(0, answered.length - ANSWERED_KEPT)),
  );
  return [
    ...list.filter((s) => !dropped.has(s)),
    { id: randomUUID(), threadId, ...input, at, status: "waiting" },
  ];
}

/** What the host sees: waiting suggestions, without who typed them. */
export const waitingOf = (list: SavedSuggestion[]): GuestSuggestion[] =>
  list.filter((s) => s.status === "waiting").map(({ guestId: _, ...s }) => s);

/** What one guest sees of their own suggestions. */
export const guestsOwn = (list: SavedSuggestion[], guestId: string) =>
  list
    .filter((s) => guestId && s.guestId === guestId)
    .map(({ text, status }) => ({ text, status }));
