import type { RenderShot } from "../../../shared/html-render";

const nextFrame = () =>
  new Promise<void>((done) => requestAnimationFrame(() => done()));

/** The outermost box over `point` that sits on top of `view` rather than in it, like the composer over the thread's end. */
function overlayAt(view: Element, x: number, y: number) {
  let hit = document.elementFromPoint(x, y);
  if (!hit || view.contains(hit)) return undefined;
  while (hit.parentElement && !hit.parentElement.contains(view))
    hit = hit.parentElement;
  return hit.getBoundingClientRect();
}

/** The part of `view` on screen that nothing covers along its top and bottom edges. */
function clearArea(view: Element | null) {
  const box = view?.getBoundingClientRect();
  const area = {
    top: Math.max(box?.top ?? 0, 0),
    bottom: Math.min(box?.bottom ?? innerHeight, innerHeight),
    left: Math.max(box?.left ?? 0, 0),
    right: Math.min(box?.right ?? innerWidth, innerWidth),
  };
  if (!view) return area;
  const x = (area.left + area.right) / 2;
  const below = overlayAt(view, x, area.bottom - 1);
  if (below) area.bottom = Math.max(area.top, below.top);
  const above = overlayAt(view, x, area.top + 1);
  if (above) area.top = Math.min(area.bottom, above.bottom);
  return area;
}

const covered = (frame: HTMLIFrameElement, rect: DOMRect) =>
  [
    [rect.left + 2, rect.top + 2],
    [rect.right - 2, rect.top + 2],
    [rect.left + 2, rect.bottom - 2],
    [rect.right - 2, rect.bottom - 2],
    [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
  ].some(([x, y]) => document.elementFromPoint(x, y) !== frame);

/**
 * Where to take the frame's picture off the window, as the user left it:
 * scrolled into the clear part of `view` when all of it fits there, else
 * nothing, and the page is loaded afresh for it. A page that scrolls inside
 * its frame never fits.
 */
export async function frameOnScreen(
  frame: HTMLIFrameElement,
  contentHeight: number | undefined,
  view: HTMLElement | null,
): Promise<RenderShot["rect"]> {
  if (contentHeight !== undefined && contentHeight > frame.clientHeight + 1)
    return undefined;
  const area = clearArea(view);
  let rect = frame.getBoundingClientRect();
  if (
    rect.height > area.bottom - area.top ||
    rect.width > area.right - area.left
  )
    return undefined;
  if (view) {
    const down =
      rect.bottom > area.bottom
        ? rect.bottom - area.bottom
        : rect.top < area.top
          ? rect.top - area.top
          : 0;
    const across =
      rect.right > area.right
        ? rect.right - area.right
        : rect.left < area.left
          ? rect.left - area.left
          : 0;
    if (down || across)
      view.scrollBy({ top: down, left: across, behavior: "instant" });
  }
  // Two frames, so what's captured is painted without the menu that asked.
  await nextFrame();
  await nextFrame();
  rect = frame.getBoundingClientRect();
  if (covered(frame, rect)) return undefined;
  const x = Math.ceil(rect.left);
  const y = Math.ceil(rect.top);
  return {
    x,
    y,
    width: Math.floor(rect.right) - x,
    height: Math.floor(rect.bottom) - y,
  };
}
