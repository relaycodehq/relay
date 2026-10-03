import { useState } from "react";

export const SHELF_PAGE = 5;

type Shelf = "snoozed" | "settled";

export type Shelves = ReturnType<typeof useShelves>;

/** Activity's Snoozed and Settled shelves: open or not, and how many they list. */
export function useShelves() {
  const [open, setOpen] = useState({ snoozed: false, settled: false });
  const [shown, setShown] = useState({
    snoozed: SHELF_PAGE,
    settled: SHELF_PAGE,
  });
  return {
    open,
    shown,
    /** Opening or closing one starts it over at its first page. */
    toggle(kind: Shelf) {
      setOpen((s) => ({ ...s, [kind]: !s[kind] }));
      setShown((s) => ({ ...s, [kind]: SHELF_PAGE }));
    },
    more: (kind: Shelf) =>
      setShown((s) => ({ ...s, [kind]: s[kind] + SHELF_PAGE })),
  };
}
