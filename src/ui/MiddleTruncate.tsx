import { useLayoutEffect, useRef, useState } from "react";
import { fitMiddle, type MiddleKind } from "../lib/middle-truncate";
import "./middle-truncate.css";

let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/** A string's drawn width in `font`, measured once on a canvas and kept. */
function measureIn(font: string) {
  context ??= document.createElement("canvas").getContext("2d");
  return (text: string) => {
    const key = `${font}\n${text}`;
    let width = widths.get(key);
    if (width === undefined) {
      if (!context) return 0;
      context.font = font;
      width = context.measureText(text).width;
      if (widths.size > 5000) widths.clear();
      widths.set(key, width);
    }
    return width;
  };
}

/**
 * A path or branch that loses its middle instead of its end when it runs out
 * of room, with the whole of it in the tooltip. The full text, hidden (and
 * drawn by CSS, so finding text or copying a selection sees it once), still
 * sizes the box, so it grows back when there is room; the shortened copy is
 * worked out again only when the box changes size.
 */
export function MiddleTruncate({
  text,
  kind,
  title = text,
  className,
}: {
  text: string;
  kind: MiddleKind;
  /** The tooltip; null leaves it to the element around. */
  title?: string | null;
  className?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const fit = () => {
      const style = getComputedStyle(element);
      const measure = measureIn(style.font);
      // Layout width, untouched by a popup's opening scale.
      const width = parseFloat(style.width) || 0;
      // Canvas and layout round a little differently: text the box was sized
      // to counts as fitting, and shortened text keeps a pixel spare.
      setShown(
        !width || measure(text) <= width + 0.5
          ? text
          : fitMiddle(text, kind, width - 1, measure),
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [text, kind]);
  return (
    <span
      ref={box}
      className={className ? `middle-truncate ${className}` : "middle-truncate"}
      title={title ?? undefined}
    >
      <span className="middle-truncate-full" data-text={text} aria-hidden />
      <span className="middle-truncate-shown">{shown}</span>
    </span>
  );
}
