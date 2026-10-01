import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** The full passage shown while a quote pill is hovered. */
interface QuoteTip {
  text: string;
  left: number;
  top: number;
  bottom: number;
}

/**
 * The quote pill the pointer rests on, after a short pause. Leaving the pill,
 * scrolling or editing the draft hides it.
 */
export function useQuoteTip(editor: Editor | null) {
  const [tip, setTip] = useState<QuoteTip | null>(null);
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    let timer: number | undefined;
    const chipOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest(".composer-quote-chip") : null;
    const hide = () => {
      window.clearTimeout(timer);
      setTip(null);
    };
    const edited = () => setTip(null);
    const over = (event: MouseEvent) => {
      const chip = chipOf(event.target);
      if (!chip) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const rect = chip.getBoundingClientRect();
        setTip({
          text: chip.getAttribute("data-quote") ?? "",
          left: rect.left,
          top: rect.top,
          bottom: rect.bottom,
        });
      }, 150);
    };
    const out = (event: MouseEvent) => {
      const chip = chipOf(event.target);
      if (
        chip &&
        !(
          event.relatedTarget instanceof Element &&
          chip.contains(event.relatedTarget)
        )
      )
        hide();
    };
    dom.addEventListener("mouseover", over);
    dom.addEventListener("mouseout", out);
    window.addEventListener("scroll", hide, true);
    editor.on("update", edited);
    return () => {
      hide();
      dom.removeEventListener("mouseover", over);
      dom.removeEventListener("mouseout", out);
      window.removeEventListener("scroll", hide, true);
      editor.off("update", edited);
    };
  }, [editor]);
  return tip;
}

export function QuoteTooltip({ tip }: { tip: QuoteTip }) {
  const above = tip.top > 160;
  return createPortal(
    <div
      role="tooltip"
      className="composer-quote-tooltip"
      style={{
        left: Math.max(12, Math.min(tip.left, innerWidth - 12 - 440)),
        top: above ? tip.top : tip.bottom,
        transform: above ? "translateY(calc(-100% - 6px))" : "translateY(6px)",
      }}
    >
      "{tip.text}"
    </div>,
    document.body,
  );
}
