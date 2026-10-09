// Selecting text in the conversation offers to quote it in the composer.
import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { TextQuote } from "lucide-react";
import { selectionQuote } from "../../../shared/composer-quotes";
import {
  ariaShortcut,
  useShortcut,
  useShortcutLabel,
} from "../../lib/shortcuts";

interface Offer {
  text: string;
  /** Viewport point the popup is anchored to, horizontally centred. */
  x: number;
  top: number;
  bottom: number;
}

/** Room the button needs so it stays inside the window. */
const WIDTH = 170;

export function SelectionQuote({
  container,
  onQuote,
}: {
  /** The scrolling message list; selections elsewhere are ignored. */
  container: RefObject<HTMLElement | null>;
  onQuote: (text: string) => void;
}) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const keys = useShortcutLabel("quote");
  useEffect(() => {
    let dragging = false;
    const clear = () => setOffer((current) => (current ? null : current));
    const message = (node: Node) =>
      (node instanceof Element ? node : node.parentElement)?.closest(
        ".project-message",
      ) ?? null;
    function measure() {
      const root = container.current,
        selection = document.getSelection();
      if (!root || !selection?.rangeCount || selection.isCollapsed)
        return clear();
      const range = selection.getRangeAt(0);
      const from = message(range.startContainer);
      if (!from || from !== message(range.endContainer) || !root.contains(from))
        return clear();
      const text = selectionQuote(selection.toString());
      if (!text) return clear();
      const rect = range.getBoundingClientRect(),
        box = root.getBoundingClientRect();
      if (!rect.width && !rect.height) return clear();
      if (rect.bottom < box.top || rect.top > box.bottom) return clear();
      setOffer({
        text,
        x: Math.min(
          Math.max(rect.left + rect.width / 2, 12 + WIDTH / 2),
          innerWidth - 12 - WIDTH / 2,
        ),
        top: Math.max(rect.top, box.top),
        bottom: Math.min(rect.bottom, box.bottom),
      });
    }
    const onSelectionChange = () => {
      if (!dragging) measure();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".chat-quote-popup")
      )
        return;
      dragging = true;
      clear();
    };
    const onPointerUp = () => {
      dragging = false;
      measure();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onSelectionChange, true);
    window.addEventListener("resize", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onSelectionChange, true);
      window.removeEventListener("resize", onSelectionChange);
    };
  }, [container]);
  const quote = (text: string) => {
    setOffer(null);
    document.getSelection()?.removeAllRanges();
    onQuote(text);
  };
  useShortcut("quote", !!offer, () => offer && quote(offer.text));
  if (!offer) return null;
  const above = offer.top > 96;
  const keep = (event: { preventDefault: () => void }) =>
    event.preventDefault();
  return createPortal(
    <button
      type="button"
      className="chat-quote-popup"
      title="Quote the selection in your message"
      aria-keyshortcuts={ariaShortcut("quote") || undefined}
      style={{
        left: offer.x,
        top: above ? offer.top : offer.bottom,
        transform: above
          ? "translate(-50%, calc(-100% - 8px))"
          : "translate(-50%, 8px)",
      }}
      onMouseDown={keep}
      onPointerDown={keep}
      onClick={() => quote(offer.text)}
    >
      <TextQuote size={14} aria-hidden="true" />
      Add to chat
      {keys && (
        <span className="chat-quote-keys" aria-hidden="true">
          <kbd>{keys}</kbd>
        </span>
      )}
    </button>,
    document.body,
  );
}
