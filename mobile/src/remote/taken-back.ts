import type { TakenBack } from "../../../shared/remote-queued";

/** A queued message bound for a side conversation's composer, until that screen is up to take it. */
export interface HandedBack {
  back: TakenBack;
  /** Still queued on the desktop; the screen that restores it takes it out. */
  messageId: string;
}

const waiting = new Map<string, HandedBack>();

export const handBack = (draftKey: string, handed: HandedBack) => void waiting.set(draftKey, handed);
export const peekHandedBack = (draftKey: string) => waiting.get(draftKey);
export const clearHandedBack = (draftKey: string) => void waiting.delete(draftKey);
