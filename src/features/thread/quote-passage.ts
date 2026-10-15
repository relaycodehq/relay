import { FLASH_MS } from "./useThreadScroll";

const LETTERS = /[\p{L}\p{N}]/gu;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * A quote's lines as bare lowercase letters and digits: copied text loses or
 * gains spaces, line breaks and list markers on the way, its words don't.
 * Lines that short say too little to look for.
 */
function quoteLines(quote: string) {
  return quote
    .split("\n")
    .map((line) =>
      (line.replace(LIST_MARKER, "").match(LETTERS) ?? [])
        .join("")
        .toLowerCase(),
    )
    .filter((line) => line.length >= 3);
}

/** The text a reader could have selected in a message: its rendered markdown, not its pills or buttons. */
function readable(node: Node) {
  const parent = node.parentElement;
  return !!parent?.closest(".markdown") &&
    !parent.closest("button, .prompt-pill, [aria-hidden='true']")
    ? NodeFilter.FILTER_ACCEPT
    : NodeFilter.FILTER_REJECT;
}

/** Where `quote` is in `message`'s text, from its first line found to its last. */
export function passageIn(message: Element, quote: string): Range | undefined {
  const lines = quoteLines(quote);
  if (!lines.length) return;
  // Each letter kept, and the text node and span it came from.
  let flat = "";
  const from: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT, {
    acceptNode: readable,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    for (const match of text.data.matchAll(LETTERS)) {
      const at = {
        node: text,
        start: match.index,
        end: match.index + match[0].length,
      };
      for (const letter of match[0].toLowerCase()) {
        flat += letter;
        from.push(at);
      }
    }
  }
  let start: number | undefined,
    end = 0,
    found = 0;
  for (const line of lines) {
    const i = flat.indexOf(line, end);
    if (i < 0) continue;
    start ??= i;
    end = i + line.length;
    found++;
  }
  // Most of it, so a stray line doesn't pass for the passage.
  if (start === undefined || found < lines.length / 2) return;
  const range = document.createRange();
  range.setStart(from[start].node, from[start].start);
  range.setEnd(from[end - 1].node, from[end - 1].end);
  return range;
}

/** The message shown above `quoting` that `quote` was taken from, the nearest first, and where in it. */
export function quotedPassage(view: Element, quoting: Element, quote: string) {
  const earlier = [
    ...view.querySelectorAll<HTMLElement>("[data-message-id]"),
  ].filter(
    (message) =>
      !message.contains(quoting) &&
      message.compareDocumentPosition(quoting) &
        Node.DOCUMENT_POSITION_FOLLOWING,
  );
  for (const message of earlier.reverse()) {
    const passage = passageIn(message, quote);
    if (passage) return { id: message.dataset.messageId!, message, passage };
  }
}

/** Lights the passage up for a moment, line by line, over its text. */
export function flashPassage(message: HTMLElement, passage: Range) {
  message.querySelectorAll(".passage-flash").forEach((lit) => lit.remove());
  const box = message.getBoundingClientRect();
  const lines: HTMLElement[] = [];
  // Per text node: a range's own rects also cover whole elements inside it.
  const common = passage.commonAncestorContainer;
  const walker = document.createTreeWalker(
    common instanceof Text ? common.parentNode! : common,
    NodeFilter.SHOW_TEXT,
    { acceptNode: readable },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!passage.intersectsNode(node)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === passage.startContainer)
      part.setStart(node, passage.startOffset);
    if (node === passage.endContainer) part.setEnd(node, passage.endOffset);
    for (const rect of part.getClientRects()) {
      if (rect.width < 1) continue;
      const lit = document.createElement("span");
      lit.className = "passage-flash";
      lit.style.cssText = `left:${rect.left - box.left - 2}px;top:${rect.top - box.top - 1}px;width:${rect.width + 4}px;height:${rect.height + 2}px`;
      lines.push(lit);
    }
  }
  message.dataset.passageFlash = "";
  message.append(...lines);
  // A timer, not animationend: with reduced motion there's no animation to end.
  setTimeout(() => {
    lines.forEach((lit) => lit.remove());
    if (!message.querySelector(".passage-flash"))
      delete message.dataset.passageFlash;
  }, FLASH_MS);
}
