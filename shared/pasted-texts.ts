/** A long paste the composer keeps as an attachment instead of inline text. */
export interface PastedText {
  /** Shown as "Pasted text #n"; stays fixed while the draft is edited. */
  n: number;
  text: string;
}

const MENTION = /^@(codex|claude)(?=\s|$)\s*/i;
// Mirrors pastedTextMessage so sent messages render as attachments again.
const BLOCK = /Pasted text #(\d+):\n\n(`{3,})\n([\s\S]*?)\n\2(?:\n\n|\s*$)/y;
const START = /(?:^|\n+)(?=Pasted text #\d+:\n)/g;

/** Unifies line endings and drops blank lines around the paste, keeping indentation. */
export const cleanPaste = (raw: string) =>
  raw
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\s+$/, "");

export const pastedLines = (text: string) => text.split("\n").length;

/** Pastes this long become attachments; shorter ones stay in the message. */
export const isLongPaste = (text: string) =>
  text.length >= 1000 || pastedLines(text) >= 12;

/** The plain text agents receive: the message, then each paste fenced after it. */
export function pastedTextMessage(pastes: PastedText[], body: string) {
  if (!pastes.length) return body;
  const mention = MENTION.exec(body.trim());
  const text = mention ? body.trim().slice(mention[0].length) : body.trim();
  const blocks = pastes.map((paste) => {
    const fence = "`".repeat(
      Math.max(
        3,
        ...(paste.text.match(/`{3,}/g) ?? []).map((f) => f.length + 1),
      ),
    );
    return `Pasted text #${paste.n}:\n\n${fence}\n${paste.text}\n${fence}`;
  });
  const message = [text, ...blocks].filter(Boolean).join("\n\n");
  return mention ? `${mention[0].trim()} ${message}` : message;
}

/** Splits trailing pastes back out of a sent message body. */
export function parsePastedTexts(body: string): {
  pastes: PastedText[];
  body: string;
} {
  const mention = MENTION.exec(body);
  const rest = mention ? body.slice(mention[0].length) : body;
  // The pastes are the first run of blocks that reaches the end.
  for (const start of rest.matchAll(START)) {
    const pastes: PastedText[] = [];
    BLOCK.lastIndex = start.index + start[0].length;
    for (let match; (match = BLOCK.exec(rest));) {
      pastes.push({ n: Number(match[1]), text: match[3] });
      if (BLOCK.lastIndex === rest.length) {
        const text = rest.slice(0, start.index);
        return { pastes, body: mention ? mention[0] + text : text };
      }
    }
  }
  return { pastes: [], body };
}
