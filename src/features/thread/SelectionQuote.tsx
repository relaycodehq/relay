// Selecting text in the conversation offers to quote it in the composer, or
// to keep it in the thread's notes.
import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Pin, TextQuote } from "lucide-react";
import { selectionQuote } from "../../../shared/composer-quotes";
import {
  selectionContext,
  selectionMarkdown,
} from "../notes/selection-markdown";
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

/** Room the buttons need so they stay inside the window. */
const WIDTH = 240;

export function SelectionQuote({
  container,
  onQuote,
  onKeep,
}: {
  /** The scrolling message list; selections elsewhere are ignored. */
  container: RefObject<HTMLElement | null>;
  onQuote: (text: string) => void;
  /** Keeps the selection, as markdown, in the thread's notes; absent where there are none. */
  onKeep?: (markdown: string, messageId?: string) => void;
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
  const keep = () => {
    const selection = document.getSelection();
    if (!onKeep || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const markdown = selectionMarkdown(
      range.cloneContents(),
      selectionContext(range),
    );
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const message = start?.closest<HTMLElement>("[data-message-id]");
    setOffer(null);
    selection.removeAllRanges();
    if (markdown) onKeep(markdown, message?.dataset.messageId);
  };
  useShortcut("quote", !!offer, () => offer && quote(offer.text));
  if (!offer) return null;
  const above = offer.top > 96;
  // The selection must outlive the press.
  const hold = (event: { preventDefault: () => void }) =>
    event.preventDefault();
  return createPortal(
    <div
      className="chat-quote-popup"
      style={{
        left: offer.x,
        top: above ? offer.top : offer.bottom,
        transform: above
          ? "translate(-50%, calc(-100% - 8px))"
          : "translate(-50%, 8px)",
      }}
      onMouseDown={hold}
      onPointerDown={hold}
    >
      <button
        type="button"
        title="Quote the selection in your message"
        aria-keyshortcuts={ariaShortcut("quote") || undefined}
        onClick={() => quote(offer.text)}
      >
        <TextQuote size={14} aria-hidden="true" />
        Add to chat
        {keys && (
          <span className="chat-quote-keys" aria-hidden="true">
            <kbd>{keys}</kbd>
          </span>
        )}
      </button>
      {onKeep && (
        <button
          type="button"
          title="Keep the selection in this thread's notes"
          onClick={keep}
        >
          <Pin size={13} aria-hidden="true" />
          Keep
        </button>
      )}
    </div>,
    document.body,
  );
}
