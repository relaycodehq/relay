import { useLayoutEffect, useState, type CSSProperties } from "react";
import { useStableCallback } from "./useStableCallback";

/** A full-width popup above its anchor, or below when that side has more room. */
export function popupBounds(
  anchor: Pick<DOMRect, "top" | "bottom" | "left" | "width">,
  viewport: { width: number; height: number },
  maxHeight: number,
  desiredHeight = maxHeight,
): CSSProperties {
  const edge = 12,
    gap = 6;
  const width = Math.max(0, Math.min(anchor.width, viewport.width - 2 * edge));
  const above = Math.max(0, anchor.top - edge - gap);
  const below = Math.max(0, viewport.height - anchor.bottom - edge - gap);
  const onTop = above >= Math.min(maxHeight, desiredHeight) || above > below;
  return {
    left: Math.max(edge, Math.min(anchor.left, viewport.width - width - edge)),
    width,
    maxHeight: Math.min(maxHeight, onTop ? above : below),
    ...(onTop
      ? { bottom: viewport.height - anchor.top + gap }
      : { top: Math.max(edge, anchor.bottom + gap) }),
  };
}

/** Tracks a popup's anchor while it is open, including content resizing it. */
export function usePopupBounds(
  open: boolean,
  anchor: () => Element | null | undefined,
  maxHeight: number,
  desiredHeight = maxHeight,
) {
  const resolve = useStableCallback(anchor);
  const [bounds, setBounds] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const target = resolve();
    if (!target) return;
    const measure = () =>
      setBounds(
        popupBounds(
          target.getBoundingClientRect(),
          { width: innerWidth, height: innerHeight },
          maxHeight,
          desiredHeight,
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, resolve, maxHeight, desiredHeight]);
  return bounds;
}
