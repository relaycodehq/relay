/**
 * Chromium's own copy writes the dark theme into the HTML it puts on the
 * clipboard, so pasting into a document brings black boxes along. Relay
 * writes the HTML itself instead: the selection's structure (paragraphs,
 * lists, tables, code, emphasis, web links) with no styles, so the pasted text
 * takes the look of wherever it lands.
 */
export function initCleanCopy() {
  document.addEventListener("copy", copyClean);
}

const SKIP = "data-copy-skip";

/** Kept as they are but stripped of attributes, apart from these. */
const KEPT_ATTRIBUTES: Record<string, string[]> = {
  A: ["href"],
  OL: ["start"],
  TD: ["colspan", "rowspan"],
  TH: ["colspan", "rowspan"],
  IMG: ["src", "alt"],
};

/** Controls, pictures and frames that mean nothing in a pasted document. */
const DROPPED =
  "svg, canvas, video, audio, iframe, input, script, style, template";

/** Formatting a selection inside it would otherwise lose, like part of a link. */
const KEPT_AROUND = new Set([
  "A",
  "B",
  "STRONG",
  "EM",
  "I",
  "S",
  "DEL",
  "CODE",
  "PRE",
]);

/** Links worth keeping in another app: the web and mail, not files on this computer. */
const webLink = (href: string | null) =>
  !!href && /^(https?:|mailto:)/i.test(href);

function copyClean(event: ClipboardEvent) {
  // A table's cells or a message's pills have been copied already.
  if (event.defaultPrevented || !event.clipboardData) return;
  if (editing(document.activeElement)) return;
  // A diff's lines live in a shadow root, which a range from the document can't reach.
  const target = event.composedPath()[0];
  if (target instanceof Node && target.getRootNode() instanceof ShadowRoot)
    return;
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const html = cleanHtml(range);
  event.clipboardData.setData("text/plain", selection.toString());
  event.clipboardData.setData("text/html", html);
  event.preventDefault();
}

function editing(element: Element | null) {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.isContentEditable ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  );
}

/** The selection as HTML without styles, classes or anything a copy skips. */
export function cleanHtml(range: Range) {
  const skipped = markSkipped(range);
  const copied = range.cloneContents();
  for (const element of skipped) element.removeAttribute(SKIP);
  const holder = document.createElement("div");
  holder.append(withFormattingAround(copied, range));
  for (const element of holder.querySelectorAll(`[${SKIP}]`)) element.remove();
  clean(holder);
  return holder.innerHTML;
}

/**
 * Marks what Chromium's copy leaves out (hidden things and `user-select:
 * none` chrome) in the page itself, since a cloned range has no styles.
 */
function markSkipped(range: Range) {
  const root = range.commonAncestorContainer;
  const marked: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      const style = getComputedStyle(node as Element);
      if (style.display !== "none" && style.userSelect !== "none")
        return NodeFilter.FILTER_SKIP;
      marked.push(node as Element);
      return NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode());
  for (const element of marked) element.setAttribute(SKIP, "");
  return marked;
}

function withFormattingAround(copied: DocumentFragment, range: Range) {
  let content: Node = copied;
  const start = range.commonAncestorContainer;
  let ancestor = start instanceof Element ? start : start.parentElement;
  while (ancestor && ancestor !== document.body) {
    if (KEPT_AROUND.has(ancestor.tagName)) {
      const wrap = ancestor.cloneNode(false) as Element;
      wrap.append(content);
      content = wrap;
    }
    ancestor = ancestor.parentElement;
  }
  return content;
}

function clean(holder: HTMLElement) {
  for (const formula of holder.querySelectorAll(".katex")) {
    const tex = formula.querySelector(
      'annotation[encoding="application/x-tex"]',
    );
    formula.replaceWith(tex?.textContent ?? "");
  }
  for (const element of holder.querySelectorAll(
    `${DROPPED}, [aria-hidden="true"]`,
  ))
    element.remove();
  for (const image of holder.querySelectorAll("img"))
    if (!/^(https?:|data:image\/)/i.test(image.getAttribute("src") ?? ""))
      image.remove();
  for (const element of holder.querySelectorAll("*")) {
    const kept = KEPT_ATTRIBUTES[element.tagName] ?? [];
    for (const { name } of [...element.attributes])
      if (!kept.includes(name)) element.removeAttribute(name);
  }
  // A file link or button keeps its text; an icon-only one is gone with its svg.
  for (const element of holder.querySelectorAll("a, button"))
    if (element.tagName === "BUTTON" || !webLink(element.getAttribute("href")))
      element.replaceWith(...element.childNodes);
}
