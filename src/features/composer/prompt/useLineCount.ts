import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";

/** How many lines the draft wraps to, for the collapsed composer's "+N lines". */
export function useLineCount(editor: Editor | null) {
  const [lines, setLines] = useState(1);
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const first = dom.firstElementChild as HTMLElement | null;
        const last = dom.lastElementChild as HTMLElement | null;
        const lineHeight = parseFloat(getComputedStyle(dom).lineHeight);
        if (!first || !last || !lineHeight) return setLines(1);
        const height = last.offsetTop + last.offsetHeight - first.offsetTop;
        setLines(Math.max(1, Math.round(height / lineHeight)));
      });
    };
    // Width changes rewrap the draft; a late web font does too.
    const resize = new ResizeObserver(measure);
    resize.observe(dom);
    editor.on("update", measure);
    void document.fonts.ready.then(measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      editor.off("update", measure);
    };
  }, [editor]);
  return lines;
}
