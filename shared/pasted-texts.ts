/** A long paste shown as a pill in the message, standing in for its text. */
export interface PastedText {
  /** Shown as "Pasted text #n". */
  n: number;
  text: string;
}

/**
 * A pill's text in the message: the paste fenced under its label, set apart
 * by blank lines. A sent message can also start with it, or with it right
 * after the agent mention.
 */
export const pasteBlock =
  /(?:^|\n\n?|(?<=^@(?:codex|claude) +))Pasted text #(\d+):\n\n(`{3,})\n([\s\S]*?)\n\2(?:\n\n|$)/g;

/** Unifies line endings and drops blank lines around the paste, keeping indentation. */
export const cleanPaste = (raw: string) =>
  raw
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\s+$/, "");

export const pastedLines = (text: string) => text.split("\n").length;

/** Pastes this long become pills; shorter ones stay ordinary text. */
export const isLongPaste = (text: string) =>
  text.length >= 1000 || pastedLines(text) >= 12;

/** Serialises a pill: the fenced paste on its own lines, where the pill sits. */
export function pasteMarkdown({ n, text }: PastedText) {
  const fence = "`".repeat(
    Math.max(3, ...(text.match(/`{3,}/g) ?? []).map((f) => f.length + 1)),
  );
  return `\n\nPasted text #${n}:\n\n${fence}\n${text}\n${fence}\n\n`;
}

/** Rewrites each paste in a message, blank lines around it included. */
export function replacePastedTexts(
  body: string,
  replace: (paste: PastedText, index: number) => string,
) {
  let index = 0;
  return body.replace(pasteBlock, (_, n: string, _fence, text: string) =>
    replace({ n: Number(n), text }, index++),
  );
}

/** The pastes in a message, in the order they appear. */
export function pastedTexts(body: string) {
  const found: PastedText[] = [];
  replacePastedTexts(body, (paste) => {
    found.push(paste);
    return "";
  });
  return found;
}
