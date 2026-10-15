import { pasteBlock } from "./pasted-texts";

/**
 * A screenshot sits in the draft as `[Image #n]`, the token Claude Code and
 * Codex use too. Agents get a message's images after its text, in order, so
 * on send the tokens are renumbered to match that order.
 */
export const imageToken = (n: number) => `[Image #${n}]`;
const imageTokenPattern = /\[Image #(\d+)\]/g;

/** The text with its screenshot tokens taken out, and the gaps they leave. */
export const withoutImageTokens = (text: string) =>
  text
    .replace(/[ \t]*\[Image #\d+\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\s+$/g, "");

/** Text that is nothing but screenshot tokens, like a pasted image sent alone. */
export const onlyImageTokens = (text: string) =>
  !text.replace(imageTokenPattern, "").trim();

interface Numbered {
  /** Its token's number; screenshots attached before tokens have none. */
  n?: number;
}

/** Rewrites the tokens in a draft, leaving pasted text alone. */
function replaceTokens(text: string, replace: (n: number) => string) {
  let out = "",
    last = 0;
  const swap = (chunk: string) =>
    chunk.replace(imageTokenPattern, (_, n: string) => replace(Number(n)));
  for (const m of text.matchAll(pasteBlock)) {
    out += swap(text.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  return out + swap(text.slice(last));
}

/** The numbers a draft refers to, in the order they first appear. */
function imageRefs(text: string): number[] {
  const seen: number[] = [];
  replaceTokens(text, (n) => {
    if (!seen.includes(n)) seen.push(n);
    return "";
  });
  return seen;
}

/**
 * The screenshots a draft sends: those its tokens point at, in token order,
 * then any from before tokens. One whose token was deleted stays in the
 * draft's store, so undo brings it back, but goes nowhere.
 */
export function attachedImages<T extends Numbered>(
  text: string,
  images: T[],
): T[] {
  return [
    ...imageRefs(text).flatMap((n) => images.filter((i) => i.n === n)),
    ...images.filter((i) => i.n === undefined),
  ];
}

/** The next number free in a draft, past its tokens and its stored screenshots. */
export const nextImageNumber = (text: string, images: Numbered[]) =>
  Math.max(0, ...imageRefs(text), ...images.map((i) => i.n ?? 0)) + 1;

/** A draft as it goes out: its screenshots, and tokens numbered 1, 2, 3 to match. */
export function numberImages<T extends Numbered>(text: string, images: T[]) {
  const attached = attachedImages(text, images);
  const sent = new Map(
    attached.flatMap((image, i) =>
      image.n === undefined ? [] : [[image.n, i + 1] as const],
    ),
  );
  return {
    text: replaceTokens(text, (n) => imageToken(sent.get(n) ?? n)),
    images: attached,
  };
}

/**
 * A sent message going back into a draft that already numbers up to `after`:
 * its nth image becomes `after + n`. Images its text never named (messages
 * from before tokens) stay unnumbered, so they still go with it.
 */
export function imagesAfter<T>(text: string, images: T[], after: number) {
  const named = new Set(imageRefs(text));
  return {
    text: after
      ? replaceTokens(text, (n) =>
          imageToken(n <= images.length ? n + after : n),
        )
      : text,
    images: images.map((image, i) =>
      named.has(i + 1) ? { ...image, n: after + i + 1 } : image,
    ),
  };
}

/**
 * Text pasted with the screenshots it was copied with, into a draft that
 * numbers up to `after`. Each token takes the next carried screenshot with its
 * number, in order, so a selection over two messages that each have an #1
 * gives each token its own message's screenshot; they're numbered on from
 * `after` in token order. Screenshots no token took go unnumbered, and a token
 * whose screenshot didn't come along goes, so it can't point at one of the
 * draft's own. Copies of one screenshot (`same` gives them the same identity,
 * like a token repeated in a message) go in once.
 */
export function pastedImages<T extends Numbered>(
  text: string,
  carried: T[],
  after: number,
  same: (image: T) => unknown = (image) => image,
) {
  const untaken = new Set(carried);
  const numbers = new Map<unknown, number>();
  const out = replaceTokens(text, (n) => {
    const image = carried.find((c) => untaken.has(c) && c.n === n);
    if (!image) return "";
    untaken.delete(image);
    const id = same(image);
    if (!numbers.has(id)) numbers.set(id, after + numbers.size + 1);
    return imageToken(numbers.get(id)!);
  });
  const kept = new Set<unknown>();
  return {
    text: out,
    images: carried.flatMap((image) => {
      const id = same(image);
      if (kept.has(id)) return [];
      kept.add(id);
      return [{ ...image, n: numbers.get(id) }];
    }),
  };
}

/** A name nobody chose: a clipboard paste, or a macOS screenshot's timestamp. */
export const isPastedImageName = (name: string) =>
  /^(image|screenshot)(\.\w+)?$|^screenshot \d{4}-\d\d-\d\d at /i.test(name);

/** Shortens a long file name in the middle, so its extension still shows. */
export function shortImageName(name: string, max = 24) {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const tail = Math.min(8, Math.floor((max - 1) / 2));
  return `${chars.slice(0, max - 1 - tail).join("")}…${chars.slice(-tail).join("")}`;
}

/** Roughly what a data URL decodes to. */
export function dataUrlBytes(dataUrl: string) {
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return (
    Math.floor((data.length * 3) / 4) - (data.match(/=*$/)?.[0].length ?? 0)
  );
}
