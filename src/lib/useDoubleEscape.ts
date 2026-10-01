import { useEffect, useRef, useState } from "react";
import { isTypingTarget, popupOpen } from "./shortcuts";

/** How long the first Escape stays armed, waiting for the second. */
const DOUBLE_ESCAPE_MS = 1500;

function inside(event: KeyboardEvent, selector: string) {
  return event.target instanceof Element && !!event.target.closest(selector);
}

/**
 * Escape twice within {@link DOUBLE_ESCAPE_MS} calls `onFire`; the first press
 * only arms it. Escape that something else handles, or that was meant for an
 * open popup or another field, doesn't count. Inside `scope` (the composer)
 * it does: ProseMirror prevents every Escape, so there only a handler that
 * stops it, like the command menu, keeps it.
 */
export function useDoubleEscape(
  active: boolean,
  scope: string,
  onFire: () => void,
) {
  const [armed, setArmed] = useState(false);
  const fire = useRef(onFire);
  fire.current = onFire;
  useEffect(() => {
    if (!active) {
      setArmed(false);
      return;
    }
    let armedNow = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let counts = false;
    let scoped = false;
    const arm = (on: boolean) => {
      clearTimeout(timer);
      armedNow = on;
      setArmed(on);
      if (on) timer = setTimeout(() => arm(false), DOUBLE_ESCAPE_MS);
    };
    // Popups close during the event, so decide before anything handles it.
    const capture = (event: KeyboardEvent) => {
      scoped = inside(event, scope);
      counts =
        event.key === "Escape" &&
        !event.repeat &&
        !event.isComposing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        // Escape there belongs to them: open popups and dialogs close, and
        // other fields (search, rename, terminal, editor) cancel their own thing.
        !popupOpen() &&
        (scoped || !isTypingTarget(event));
      if (event.key !== "Escape" && armedNow) arm(false);
    };
    const bubble = (event: KeyboardEvent) => {
      if (!counts || (event.defaultPrevented && !scoped)) return;
      if (!armedNow) return arm(true);
      arm(false);
      fire.current();
    };
    const blur = () => arm(false);
    window.addEventListener("keydown", capture, true);
    window.addEventListener("keydown", bubble);
    window.addEventListener("blur", blur);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("keydown", bubble);
      window.removeEventListener("blur", blur);
    };
  }, [active, scope]);
  return armed;
}
