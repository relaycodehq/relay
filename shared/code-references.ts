/** Lines of local code attached to a chat message. */
export interface CodeReference {
  path: string;
  start: number;
  end: number;
  /** Which version the lines came from, e.g. "Working file" or "HEAD". */
  label: string;
  code: string;
}

const MENTION = /^@(codex|claude)(?=\s|$)\s*/i;
// Mirrors codeReferenceMessage so sent messages render as pills again.
const BLOCK =
  /^About (.+?):(\d+)(?:–(\d+))? \(([^()\n]+)\):\n\n(`{3,})\n([\s\S]*?)\n?\5(?:\n+|$)/;

export function isCodeReference(value: unknown): value is CodeReference {
  const v = value as CodeReference | null;
  return (
    !!v &&
    typeof v.path === "string" &&
    Number.isInteger(v.start) &&
    Number.isInteger(v.end) &&
    typeof v.label === "string" &&
    typeof v.code === "string"
  );
}

export function sameCodeReference(a: CodeReference, b: CodeReference) {
  return (
    a.path === b.path &&
    a.start === b.start &&
    a.end === b.end &&
    a.label === b.label
  );
}

export function codeReferenceLines(ref: Pick<CodeReference, "start" | "end">) {
  return ref.start === ref.end ? `${ref.start}` : `${ref.start}–${ref.end}`;
}

/** The plain text agents receive: each reference as a fenced excerpt. */
export function codeReferenceMessage(refs: CodeReference[], body: string) {
  if (!refs.length) return body;
  const mention = MENTION.exec(body.trim());
  const text = mention ? body.trim().slice(mention[0].length) : body.trim();
  const blocks = refs.map((ref) => {
    const fence = "`".repeat(
      Math.max(3, ...(ref.code.match(/`{3,}/g) ?? []).map((f) => f.length + 1)),
    );
    return `About ${ref.path}:${codeReferenceLines(ref)} (${ref.label}):\n\n${fence}\n${ref.code}\n${fence}`;
  });
  const message = [...blocks, text].filter(Boolean).join("\n\n");
  return mention ? `${mention[0].trim()} ${message}` : message;
}

/** Splits leading code references back out of a sent message body. */
export function parseCodeReferences(body: string): {
  refs: CodeReference[];
  body: string;
} {
  const mention = MENTION.exec(body);
  let rest = mention ? body.slice(mention[0].length) : body;
  const refs: CodeReference[] = [];
  for (let match; (match = BLOCK.exec(rest));) {
    refs.push({
      path: match[1],
      start: Number(match[2]),
      end: Number(match[3] ?? match[2]),
      label: match[4],
      code: match[6],
    });
    rest = rest.slice(match[0].length);
  }
  if (!refs.length) return { refs, body };
  return { refs, body: mention ? `${mention[0]}${rest}` : rest };
}
