import { createContext, useContext } from "react";

/**
 * Where the open thread's Running card holds the thread's own controls: its
 * element while the card is open, null while it's folded. Undefined where
 * there's no card, so they stay where they were.
 */
export const CardSlot = createContext<HTMLElement | null | undefined>(
  undefined,
);

export const useCardSlot = () => useContext(CardSlot);
