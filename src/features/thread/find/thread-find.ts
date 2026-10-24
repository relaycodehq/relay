import type { ChatMessage } from "../../../../shared/projects";

/** Past this many the count reads "1000+" and the rest go unmarked. */
export const MAX_MATCHES = 1000;

export interface ThreadMatch {
  /** The message it is in. */
  id: string;
  /** Which of that message's matches, which stays put as messages above it mount. */
  nth: number;
  message: HTMLElement;
  range: Range;
}

/**
 * Where `query` appears in `text`, ignoring case, as start offsets.
 * Lowercasing can change the text's length (İ), and with it every offset;
 * then case counts.
 */
export function offsetsOf(text: string, query: string, limit = MAX_MATCHES) {
  const found: number[] = [];
  if (!query) return found;
  let haystack = text.toLowerCase();
  let needle = query.toLowerCase();
  if (haystack.length !== text.length || needle.length !== query.length) {
    haystack = text;
    needle = query;
  }
  for (
    let at = haystack.indexOf(needle);
    at !== -1 && found.length < limit;
    at = haystack.indexOf(needle, at + needle.length)
  )
    found.push(at);
  return found;
}

/** Text the reader can see: not a collapsed fold's, nor what's hidden from them. */
function readable(cache: Map<Element, boolean>) {
  return (node: Node) => {
    const parent = node.parentElement;
    if (!parent) return NodeFilter.FILTER_REJECT;
    let shown = cache.get(parent);
    if (shown === undefined) {
      // Off-screen messages skip layout (content-visibility: auto) yet count as shown.
      shown =
        !parent.closest("[aria-hidden='true'], script, style") &&
        (parent.checkVisibility?.() ?? true);
      cache.set(parent, shown);
    }
    return shown ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
  };
}

/**
 * Every place `query` appears in the messages drawn under `column`, in
 * reading order. A message's text is searched as one, so a phrase is found
 * across its bold, links and inline code.
 */
export function findInThread(column: Element, query: string) {
  const matches: ThreadMatch[] = [];
  if (!query) return matches;
  const visible = new Map<Element, boolean>();
  const messages = [
    ...column.querySelectorAll<HTMLElement>("[data-message-id]"),
  ].filter((m) => !m.parentElement?.closest("[data-message-id]"));
  for (const message of messages) {
    const nodes: Text[] = [];
    const starts: number[] = [];
    let text = "";
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT, {
      acceptNode: readable(visible),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push(node as Text);
      starts.push(text.length);
      text += (node as Text).data;
    }
    // The text node holding character `at`, and where in it.
    let n = 0;
    const point = (at: number, end: boolean) => {
      while (n + 1 < nodes.length && starts[n + 1] + (end ? 0 : -1) < at) n++;
      return [nodes[n], at - starts[n]] as const;
    };
    const left = MAX_MATCHES - matches.length;
    offsetsOf(text, query, left).forEach((at, nth) => {
      const range = document.createRange();
      range.setStart(...point(at, false));
      range.setEnd(...point(at + query.length, true));
      matches.push({ id: message.dataset.messageId!, nth, message, range });
    });
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches;
}

// Markdown's emphasis and code marks, which the drawn text doesn't show.
const plain = (text: string) => text.replace(/[*_`~]/g, "");

/**
 * The oldest of `shown` whose text has `query`, for mounting back to; the
 * view keeps only the latest messages drawn. It reads the markdown, so a
 * phrase split by **bold** still counts.
 */
export function oldestWith(shown: ChatMessage[], query: string) {
  const needle = plain(query);
  return needle
    ? shown.find((m) => offsetsOf(plain(m.body), needle, 1).length)
    : undefined;
}
