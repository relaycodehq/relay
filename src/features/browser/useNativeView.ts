import { useEffect, type RefObject } from "react";
import type { PreviewBounds } from "../../../shared/preview";

/** Things that open over the page: menus, popovers, dialogs, the image viewer. */
const OVERLAYS =
  "[role=menu], [role=listbox], [role=dialog], [role=alertdialog], dialog[open]";

const meets = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Whether anything outside `host` overlaps the rect, on screen. */
function covered(host: HTMLElement, rect: DOMRect) {
  for (const element of document.querySelectorAll<HTMLElement>(OVERLAYS)) {
    if (host.contains(element)) continue;
    const box = element.getBoundingClientRect();
    if (box.width && box.height && meets(box, rect)) return true;
  }
  // Portaled popups that name no role, like hover cards and tooltips.
  for (const child of document.body.children) {
    if (child.id === "root" || !(child instanceof HTMLElement)) continue;
    for (const element of [child, ...child.querySelectorAll<HTMLElement>(":scope > *")]) {
      const box = element.getBoundingClientRect();
      if (box.width && box.height && meets(box, rect)) return true;
    }
  }
  return false;
}

/**
 * Keeps a native view laid over `host`: following it as panes move and
 * resize, and taken off whenever it isn't showing or something opens over
 * it, since a native view always draws above the page.
 */
export function useNativeView(
  host: RefObject<HTMLElement | null>,
  show: boolean,
  place: (bounds: PreviewBounds | null) => void,
) {
  useEffect(() => {
    const element = host.current;
    if (!element || !show) return;
    let last = "";
    let dragging = false;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const visible =
        !dragging &&
        rect.width > 0 &&
        rect.height > 0 &&
        element.checkVisibility() &&
        !covered(element, rect);
      const bounds = visible
        ? {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          }
        : null;
      const next = JSON.stringify(bounds);
      if (next === last) return;
      last = next;
      place(bounds);
    };
    const soon = () => {
      frame ||= requestAnimationFrame(update);
    };
    const resizes = new ResizeObserver(soon);
    resizes.observe(element);
    resizes.observe(document.documentElement);
    const mutations = new MutationObserver(soon);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "hidden", "style", "data-open"],
    });
    // A pane dragged over it would never see the drop.
    const dragStart = () => {
      dragging = true;
      soon();
    };
    const dragEnd = () => {
      dragging = false;
      soon();
    };
    document.addEventListener("dragstart", dragStart);
    document.addEventListener("dragend", dragEnd);
    document.addEventListener("drop", dragEnd);
    window.addEventListener("resize", soon);
    // Moves without a resize, like panes trading places, show up here.
    const poll = setInterval(soon, 750);
    update();
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(poll);
      resizes.disconnect();
      mutations.disconnect();
      document.removeEventListener("dragstart", dragStart);
      document.removeEventListener("dragend", dragEnd);
      document.removeEventListener("drop", dragEnd);
      window.removeEventListener("resize", soon);
      place(null);
    };
  }, [host, show, place]);
}
