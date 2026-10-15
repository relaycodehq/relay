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
 * The passage of the quote pill the pointer rests on, after a short pause,
 * in the editor or any element showing quote pills. Moving off
 * the pill, clicking, typing or scrolling hides it.
 */
export function useQuoteTip(within: Editor | HTMLElement | null) {
  const [tip, setTip] = useState<QuoteTip | null>(null);
  useEffect(() => {
    if (!within) return;
    const root = within instanceof HTMLElement ? within : within.view.dom;
    let timer: number | undefined;
    let hovered: Element | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      hovered = null;
      setTip(null);
    };
    const over = (event: MouseEvent) => {
      const pill =
        event.target instanceof Element
          ? event.target.closest(".prompt-pill.quote[data-relay-quote]")
          : null;
      if (pill === hovered) return;
      hide();
      if (!pill) return;
      hovered = pill;
      timer = window.setTimeout(() => {
        const rect = pill.getBoundingClientRect();
        setTip({
          text: pill.getAttribute("data-relay-quote")!,
          left: rect.left,
          top: rect.top,
          bottom: rect.bottom,
        });
      }, 150);
    };
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseleave", hide);
    root.addEventListener("mousedown", hide);
    root.addEventListener("keydown", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseleave", hide);
      root.removeEventListener("mousedown", hide);
      root.removeEventListener("keydown", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [within]);
  return tip;
}

export function QuoteTooltip({ tip }: { tip: QuoteTip }) {
  const above = tip.top > 160;
  return createPortal(
    <div
      role="tooltip"
      className="prompt-pill-tooltip"
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
