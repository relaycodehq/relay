import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** A folded line's height, in ems of the text's own size. */
const LINE_EM = 1.6;

/** Long content folded to a few lines, fading out above a Show all. */
export function Folded({
  lines,
  children,
}: {
  lines: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // An answer still streaming grows past its fold, so this keeps watching.
  useLayoutEffect(() => {
    const check = () => {
      if (!box.current || !content.current) return;
      const fontSize = parseFloat(getComputedStyle(box.current).fontSize);
      setLong(content.current.offsetHeight > fontSize * lines * LINE_EM + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [lines]);
  const folded = long && !open;
  return (
    <>
      <div
        ref={box}
        className="second-opinion-fold"
        data-folded={folded ? "" : undefined}
        style={folded ? { maxHeight: `${lines * LINE_EM}em` } : undefined}
      >
        <div ref={content}>{children}</div>
      </div>
      {long && (
        <button
          type="button"
          className="second-opinion-unfold"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </>
  );
}
