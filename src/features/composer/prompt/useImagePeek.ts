import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { PEEK_DELAY } from "../../images/ImagePeek";

/** The screenshot pill the pointer rests on, its picture grown above it as in the thread. */
export function useImagePeek(editor: Editor | null) {
  const [peek, setPeek] = useState<{ anchor: Element; src: string } | null>(
    null,
  );
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    let timer: number | undefined;
    let hovered: Element | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      hovered = null;
      setPeek(null);
    };
    const over = (event: MouseEvent) => {
      const chip =
        event.target instanceof Element
          ? event.target.closest(".composer-image-chip")
          : null;
      if (chip === hovered) return;
      hide();
      const thumb = chip?.querySelector<HTMLImageElement>("img");
      if (!chip || !thumb) return;
      hovered = chip;
      timer = window.setTimeout(
        () => setPeek({ anchor: chip, src: thumb.src }),
        PEEK_DELAY,
      );
    };
    dom.addEventListener("mouseover", over);
    dom.addEventListener("mouseleave", hide);
    // Clicking opens the drawing editor, and typing may take the pill away.
    dom.addEventListener("mousedown", hide);
    dom.addEventListener("keydown", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      dom.removeEventListener("mouseover", over);
      dom.removeEventListener("mouseleave", hide);
      dom.removeEventListener("mousedown", hide);
      dom.removeEventListener("keydown", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [editor]);
  return [peek, setPeek] as const;
}
