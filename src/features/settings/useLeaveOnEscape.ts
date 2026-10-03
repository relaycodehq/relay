import { useEffect, useRef } from "react";

/**
 * Escape calls `leave`. Popups and fields that handle it themselves keep it;
 * popups close during the event, so decide first.
 */
export function useLeaveOnEscape(leave: () => void) {
  const latest = useRef(leave);
  latest.current = leave;
  useEffect(() => {
    let counts = false;
    const capture = (e: KeyboardEvent) => {
      counts =
        e.key === "Escape" &&
        !e.isComposing &&
        !document.querySelector('dialog[open], [role="dialog"], [role="menu"]');
    };
    const bubble = (e: KeyboardEvent) => {
      if (counts && !e.defaultPrevented) latest.current();
    };
    window.addEventListener("keydown", capture, true);
    window.addEventListener("keydown", bubble);
    return () => {
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("keydown", bubble);
    };
  }, []);
}
