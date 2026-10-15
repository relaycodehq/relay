import { PILL_MARK } from "./Pill";

/** The skills, quotes and files copied HTML marks as pills, which a draft pastes back as pills. */
export interface CopiedPills {
  /** Labels by token. */
  skills: Record<string, string>;
  quotes: string[];
  files: string[];
}

/** The pills marked in `root`. */
function pillsIn(root: ParentNode): CopiedPills {
  const values = (mark: string) =>
    [...root.querySelectorAll(`[${mark}]`)].map((el) => el.getAttribute(mark)!);
  return {
    skills: Object.fromEntries(
      [...root.querySelectorAll<HTMLElement>(`[${PILL_MARK.skill}]`)].map(
        (el) => [
          el.getAttribute(PILL_MARK.skill)!,
          el.dataset.label || el.getAttribute(PILL_MARK.skill)!,
        ],
      ),
    ),
    quotes: values(PILL_MARK.quote),
    files: values(PILL_MARK.file),
  };
}

export function copiedPills(html: string): CopiedPills | undefined {
  if (!html.includes("data-relay-")) return undefined;
  return pillsIn(new DOMParser().parseFromString(html, "text/html"));
}

/**
 * Marks for `pills`, for HTML written without them (the Copy button's), so a
 * draft it's pasted into knows them; other apps show nothing for them.
 */
export function pillMarks({ skills, quotes, files }: CopiedPills) {
  // Built as elements, so their values come out escaped.
  const mark = (attrs: Record<string, string>) => {
    const span = document.createElement("span");
    for (const [name, value] of Object.entries(attrs))
      span.setAttribute(name, value);
    return span.outerHTML;
  };
  return [
    ...Object.entries(skills).map(([token, label]) =>
      mark({ [PILL_MARK.skill]: token, "data-label": label }),
    ),
    ...quotes.map((quote) => mark({ [PILL_MARK.quote]: quote })),
    ...files.map((path) => mark({ [PILL_MARK.file]: path })),
  ].join("");
}

/**
 * Copies a selection inside `root` with each pill as the text it stands for
 * (its `data-copy`) instead of its label, keeping the marks in the HTML.
 */
export function copyWithPills(event: ClipboardEvent, root: HTMLElement) {
  const selection = document.getSelection();
  // A table in it may have copied its cells already.
  if (event.defaultPrevented || !selection?.rangeCount || selection.isCollapsed)
    return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  const copied = range.cloneContents();
  if (!copied.querySelector("[data-copy]")) return;
  const html = document.createElement("div");
  html.append(copied.cloneNode(true));
  for (const pill of copied.querySelectorAll<HTMLElement>("[data-copy]"))
    pill.replaceWith(pill.dataset.copy!.trim());
  // Laid out off screen inside root, so innerText keeps its line breaks.
  const holder = document.createElement("div");
  holder.style.cssText =
    "position:fixed;left:-99999px;top:0;white-space:pre-wrap";
  holder.append(copied);
  root.append(holder);
  const text = holder.innerText;
  holder.remove();
  event.clipboardData?.setData("text/plain", text);
  event.clipboardData?.setData("text/html", html.innerHTML);
  event.preventDefault();
}
