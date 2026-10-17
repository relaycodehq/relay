import { useRef, type MouseEvent, type PointerEvent } from "react";

type BackdropTest = (e: MouseEvent<HTMLElement>) => boolean;

const onSelf: BackdropTest = (e) => e.target === e.currentTarget;

/**
 * Closes a dialog on a click on its backdrop, but only when the press started
 * there too: selecting text in an input and letting go past the dialog's edge
 * fires a click on the dialog itself, which would otherwise close it.
 */
export function useBackdropClose(
  close: () => void,
  isBackdrop: BackdropTest = onSelf,
) {
  const pressed = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      pressed.current = isBackdrop(e);
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const started = pressed.current;
      pressed.current = false;
      if (started && isBackdrop(e)) close();
    },
  };
}
