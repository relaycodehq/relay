import { createContext, use, type ReactNode } from "react";
import type { ComposerNoticeActions } from "./composer-conversation";

/**
 * What the composer shows around the draft about the conversation: it
 * changes with every streamed piece, the draft and its controls don't. The
 * composer draws each where it belongs and reads it from context, so a
 * change to these redraws them alone.
 */
export interface ComposerSlots {
  /** The row above it: what the conversation is about, and where it works. */
  context?: ReactNode;
  /** Sits on top of the input, attached to it; given what it may send through the composer. */
  notice?: ReactNode | ((composer: ComposerNoticeActions) => ReactNode);
  /** A quiet line under the composer, in the room its dock keeps there anyway. */
  below?: ReactNode;
  /** The context window's meter, among the controls. */
  meter?: ReactNode;
  /** What goes with the message besides its text. */
  attached?: ReactNode;
}

const Slots = createContext<ComposerSlots>({});

export const ComposerSlotsProvider = Slots.Provider;

export function ComposerSlot({
  name,
}: {
  name: Exclude<keyof ComposerSlots, "notice" | "below">;
}) {
  return use(Slots)[name];
}

export function ComposerNotice(actions: ComposerNoticeActions) {
  const { notice } = use(Slots);
  return typeof notice === "function" ? notice(actions) : notice;
}

export function ComposerBelow() {
  const { below } = use(Slots);
  return below && <div className="composer-below">{below}</div>;
}
