import { useCallback, useRef } from "react";
import type { PopoverRoot } from "@base-ui/react/popover";

type OnOpenChange = (
  open: boolean,
  details: PopoverRoot.ChangeEventDetails,
) => void;

/**
 * `onOpenChange` for a popover whose trigger opens on hover. Base UI closes
 * one the hover opened when its trigger is clicked more than half a second
 * later, so the natural click after hovering shuts what it meant to keep;
 * here that click pins it open, past the pointer leaving, until a second
 * click, Esc or a click outside.
 */
export function usePinOnClick(onOpenChange?: OnOpenChange): OnOpenChange {
  const how = useRef<"hover" | "pinned">(undefined);
  const forward = useRef(onOpenChange);
  forward.current = onOpenChange;
  return useCallback((open, details) => {
    const { reason } = details;
    if (how.current === "hover" && reason === "trigger-press") {
      how.current = "pinned";
      details.cancel();
      return;
    }
    if (how.current === "pinned" && !open && reason === "trigger-hover") {
      details.cancel();
      return;
    }
    how.current = !open
      ? undefined
      : reason === "trigger-hover"
        ? "hover"
        : "pinned";
    forward.current?.(open, details);
  }, []);
}
