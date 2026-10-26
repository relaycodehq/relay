const OPENERS = "([{<";
const CLOSERS = ")]}>";
const QUOTES = `"'\``;

/** Past this, even a single parameter gets a line of its own. */
const LONG_SIGNATURE = 60;

/**
 * `signature` with each parameter of its first list on its own line, as
 * JetBrains shows a declaration with several. One already over several lines
 * is the server's layout and stays.
 */
export function oneParamPerLine(signature: string) {
  if (signature.includes("\n")) return signature;
  const list = firstParamList(signature);
  if (!list) return signature;
  const params = splitTopLevel(signature.slice(list.from + 1, list.to));
  const severalOrLong = params.length > 1 || signature.length > LONG_SIGNATURE;
  if (!params.length || !severalOrLong) return signature;
  const head = signature.slice(0, list.from + 1);
  const tail = signature.slice(list.to);
  return [head, ...params.map((param) => `    ${param},`), tail].join("\n");
}

type Mark = { at: number; char: string; kind: "open" | "close" | "comma" };

/** Brackets and commas outside quotes, leaving out the `>` of `=>` and `->`. */
function* marks(text: string): Generator<Mark> {
  let quote = "";
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quote) {
      if (char === "\\") at++;
      else if (char === quote) quote = "";
      continue;
    }
    const arrowHead = char === ">" && /[=-]/.test(text[at - 1] ?? "");
    if (QUOTES.includes(char)) quote = char;
    else if (OPENERS.includes(char)) yield { at, char, kind: "open" };
    else if (CLOSERS.includes(char) && !arrowHead) yield { at, char, kind: "close" };
    else if (char === ",") yield { at, char, kind: "comma" };
  }
}

/** The first `(…)` outside any other bracket. */
function firstParamList(signature: string) {
  let depth = 0;
  let from = -1;
  for (const mark of marks(signature)) {
    if (mark.kind === "open") {
      if (depth === 0 && mark.char === "(" && from < 0) from = mark.at;
      depth++;
    } else if (mark.kind === "close") {
      depth--;
      if (depth === 0 && from >= 0) return { from, to: mark.at };
      if (depth < 0) return undefined;
    }
  }
  return undefined;
}

/** `text` split at the commas outside brackets and quotes, each part trimmed. */
function splitTopLevel(text: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (const mark of marks(text)) {
    if (mark.kind === "open") depth++;
    else if (mark.kind === "close") depth--;
    else if (depth === 0) {
      parts.push(text.slice(start, mark.at).trim());
      start = mark.at + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}
