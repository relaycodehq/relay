// Clicking text doesn't move focus, so the area last clicked into is the one
// the keys mean while nothing else holds focus.
let lastPointer: EventTarget[] = [];
let tracking = false;

/** Starts noting where clicks land; call it before the first key press counts. */
export function watchPointer() {
  if (tracking) return;
  tracking = true;
  window.addEventListener(
    "pointerdown",
    (e) => {
      lastPointer = e.composedPath();
    },
    true,
  );
}

/** A key pressed inside `area`, or with nothing focused after a click into it. */
export function meantFor(area: Element, e: KeyboardEvent) {
  if (e.composedPath().includes(area)) return true;
  const focus = document.activeElement;
  return (!focus || focus === document.body) && lastPointer.includes(area);
}
