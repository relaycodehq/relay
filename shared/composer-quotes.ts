// A quoted passage travels in the draft as a Markdown blockquote, so the
// agent and the transcript read it the same way the composer pill shows it.

/** Serialises a quote pill: every line prefixed, then a blank line. */
export const quoteMarkdown = (text: string) =>
  text
    .split("\n")
    .map((line) => "> " + line)
    .join("\n") + "\n\n";

/** A blockquote at the start of a line, including the blank line that ends it. */
export const quoteBlock = /(?<![^\n])(?:>[^\n]*(?:\n|$))+\n?/g;

/** The passage inside a blockquote block, inverse of quoteMarkdown. */
export const unquote = (block: string) =>
  block
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n");

/** Tidies a browser selection: trailing spaces and runs of blank lines go, indentation stays. */
export function selectionQuote(raw: string) {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** One-line preview for a pill or tooltip. */
export function quoteLabel(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}

/**
 * The start of a message to quote from a phone, where there is no selecting a
 * passage: its first `lines` lines and at most `chars` characters, ending in
 * " …" where it was cut.
 */
export function quoteExcerpt(text: string, lines = 8, chars = 600) {
  const whole = selectionQuote(text);
  let cut = whole.split("\n").slice(0, lines).join("\n");
  if (cut.length > chars) cut = cut.slice(0, chars).replace(/\s+\S*$/, "");
  cut = cut.replace(/\s+$/, "");
  return cut.length < whole.length ? cut + " …" : cut;
}
