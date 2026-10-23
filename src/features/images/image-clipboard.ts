import { imageToken } from "../../../shared/image-refs";
import {
  browserAnnotationSchema,
  type BrowserAnnotation,
} from "../../../shared/browser-annotations";
import { dataUrlFile } from "./image-drag";

/**
 * A screenshot copied along with the text it sits in. `n` is its token in
 * that text; without one it went with the message but had no pill.
 */
export interface CopiedImage {
  n?: number;
  name: string;
  /** A data URL. */
  src: string;
  /** The browser comment the screenshot is the picture of. */
  browser?: BrowserAnnotation;
}

const MARK = "data-relay-image";
const escaped = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
// A browser comment rides along for the composer, and shows as text elsewhere.
const tag = (image: CopiedImage) =>
  `<img ${MARK}="${image.n ?? ""}" data-name="${escaped(image.name)}"${image.browser ? ` data-browser="${escaped(JSON.stringify(image.browser))}"` : ""} alt="${escaped(image.name)}" src="${escaped(image.src)}">${image.browser ? ` ${escaped(image.browser.comment)}` : ""}`;

/**
 * A sent message as HTML, each screenshot where its token was and any without
 * one after the text. The composer reads the screenshots back out of it on
 * paste; other apps show them inline.
 */
export function messageHtml(text: string, images: CopiedImage[]) {
  const placed = new Set<number>();
  const body = text
    .split(/(\[Image #\d+\])/)
    .map((part, i) => {
      if (i % 2) {
        const n = Number(part.slice(8, -1));
        const image = images.find((image) => image.n === n);
        if (image) {
          placed.add(n);
          return tag(image);
        }
      }
      return escaped(part).replace(/\n/g, "<br>");
    })
    .join("");
  const rest = images.filter((image) => !placed.has(image.n ?? 0));
  return `<div>${body}${rest.length ? "<br>" : ""}${rest.map(tag).join("")}</div>`;
}

/**
 * The screenshots copied HTML carries, as files, with the token each had, in
 * the order they sit in it. One screenshot shown twice (its token repeated)
 * comes back as the same file each time.
 */
export function copiedImages(html: string): {
  n?: number;
  file: File;
  src: string;
  browser?: BrowserAnnotation;
}[] {
  if (!html.includes(MARK)) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const files = new Map<string, File | undefined>();
  return [...doc.querySelectorAll<HTMLImageElement>(`img[${MARK}]`)].flatMap(
    (img) => {
      const src = img.getAttribute("src") ?? "",
        name = img.dataset.name || "image.png";
      const key = `${name}\n${src}`;
      if (!files.has(key)) files.set(key, dataUrlFile(src, name));
      const file = files.get(key);
      const n = Number(img.getAttribute(MARK));
      const browser = browserComment(img.dataset.browser);
      return file
        ? [
            {
              n: n > 0 ? n : undefined,
              file,
              src,
              ...(browser ? { browser } : {}),
            },
          ]
        : [];
    },
  );
}

function browserComment(json: string | undefined) {
  if (!json) return undefined;
  try {
    return browserAnnotationSchema.parse(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/** What a screenshot pill carries when a selection over it is copied. */
export const copiedPill = (n: number, name: string) => ({
  [MARK]: String(n),
  "data-name": name,
  alt: imageToken(n),
});
