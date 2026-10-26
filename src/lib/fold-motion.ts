// Height changes at the end of a thread, eased in place of one frame's jump:
// the thread stays pinned to its end, so anything that suddenly grows or
// shrinks there moves everything the reader sees. The pin follows each frame.
import { reducedMotion } from "./slide-row";

/** How long a fold or grow takes. */
export const foldMs = 260;

// Eased at both ends: a fold that starts fast reads as the jump it replaces.
const timing = { duration: foldMs, easing: "cubic-bezier(.4,0,.2,1)" };

/** The room a box takes now: its height and the space around it. */
function roomOf(el: HTMLElement): Keyframe {
  const style = getComputedStyle(el);
  return {
    height: `${el.getBoundingClientRect().height}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
    opacity: 1,
  };
}

const noRoom: Keyframe = {
  height: "0px",
  paddingTop: "0px",
  paddingBottom: "0px",
  marginTop: "0px",
  marginBottom: "0px",
  opacity: 0,
};

/**
 * Whether to move at all. A window behind another still draws every frame of
 * an animation nobody sees: a turn's rows growing in doubled Relay's CPU while
 * unfocused. Asked before measuring, which costs a layout of its own.
 */
export const moves = () => !reducedMotion() && document.hasFocus();

/** Plays `frames` clipped to the box. */
function play(el: HTMLElement, frames: Keyframe[], fill: FillMode) {
  const { overflow, boxSizing } = el.style;
  el.style.overflow = "hidden";
  el.style.boxSizing = "border-box";
  const animation = el.animate(frames, { ...timing, fill });
  const restore = () => {
    el.style.overflow = overflow;
    el.style.boxSizing = boxSizing;
  };
  // Folded to nothing, it stays clipped until it's removed, or what it held
  // spills out and stretches the thread for a frame.
  if (fill === "none") animation.addEventListener("finish", restore);
  animation.addEventListener("cancel", restore);
  return animation;
}

/** Folds `el` away to nothing, where it stays until its owner removes it. */
export const foldAway = (el: HTMLElement) =>
  moves() ? play(el, [roomOf(el), noRoom], "forwards") : undefined;

/** Opens `el` from nothing to the room it takes. */
export const growIn = (el: HTMLElement) =>
  moves() ? play(el, [noRoom, roomOf(el)], "none") : undefined;
