import { useEffect, useRef } from "react";
import { matches } from "./shortcuts";

/**
 * Calls the latest `save` on the save shortcut. Not useShortcut: saving works
 * while typing, inside the editor's own dialog, and before anything else hears
 * the keys.
 */
export function useSaveShortcut(save: () => unknown) {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (matches("save", event)) {
        event.preventDefault();
        event.stopPropagation();
        void latest.current();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);
}
