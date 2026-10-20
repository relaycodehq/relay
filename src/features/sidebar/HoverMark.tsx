// Rows hanging off a group's line get no hover tint; instead one mark on the
// line slides to the row under the pointer.
import { useEffect, useRef } from "react";

const ROWS = ".sb-project-row, .sb-folder-row, .sb-thread-row, .sb-thread";
/** How far in from its body's edge sidebar.css draws a group's line. */
const LINE_X = 10;

/** The mark, placed in the list whose groups it marks rows in. */
export function HoverMark() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mark = ref.current;
    const list = mark?.parentElement;
    if (!mark || !list) return;
    let row: Element | null = null;
    let body: Element | null = null;
    let at = "";
    const place = (next: Element | null) => {
      const nextBody = next?.closest(".sb-folder-body") ?? null;
      if (!next || !nextBody) {
        row = body = null;
        mark.style.transform = `${at} scaleY(0.3)`;
        delete mark.dataset.shown;
        return;
      }
      const origin = list.getBoundingClientRect();
      const box = next.getBoundingClientRect();
      const x =
        nextBody.getBoundingClientRect().left - origin.left + LINE_X - 1;
      const y =
        box.top -
        origin.top +
        list.scrollTop +
        (box.height - mark.offsetHeight) / 2;
      at = `translate(${x}px, ${y}px)`;
      if (nextBody !== body) {
        // Into another group: it grows in at the row rather than sliding there.
        mark.style.transition = "none";
        mark.style.transform = `${at} scaleY(0.3)`;
        void mark.offsetHeight;
        mark.style.transition = "";
      }
      mark.style.transform = at;
      mark.dataset.shown = "";
      row = next;
      body = nextBody;
    };
    const over = (e: MouseEvent) => {
      const target = e.target as Element;
      const next = target.closest(ROWS);
      // Between two rows of its group it stays put, to slide on from there.
      if (!next && body && target.closest(".sb-folder-body") === body) return;
      place(next);
    };
    const leave = () => place(null);
    // Folding a project moves the rows under the pointer.
    const click = () =>
      requestAnimationFrame(() => row && place(row.isConnected ? row : null));
    list.addEventListener("mouseover", over);
    list.addEventListener("mouseleave", leave);
    list.addEventListener("click", click);
    return () => {
      list.removeEventListener("mouseover", over);
      list.removeEventListener("mouseleave", leave);
      list.removeEventListener("click", click);
    };
  }, []);
  return <div ref={ref} className="sb-hover-mark" aria-hidden />;
}
