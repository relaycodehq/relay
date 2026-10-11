export type LineEnding = "CRLF" | "LF";

function style(text: string): LineEnding | "mixed" | null {
  const crlf = text.split("\r\n").length - 1,
    lf = text.split("\n").length - 1;
  if (!lf) return null;
  return crlf === lf ? "CRLF" : crlf ? "mixed" : "LF";
}

/**
 * The old side rewritten to the new side's line endings when each side uses
 * one kind throughout and they differ, as with a CRLF working file over an LF
 * index (Git's autocrlf). Otherwise every line would show as changed. The new
 * side stays byte for byte, since an editor may be showing it.
 */
export function matchLineEndings(
  old: string,
  next: string,
): { old: string; eol?: LineEnding } {
  const from = style(old),
    to = style(next);
  if (from === to || !from || !to || from === "mixed" || to === "mixed")
    return { old };
  return {
    old: to === "CRLF" ? old.replace(/\n/g, "\r\n") : old.replace(/\r\n/g, "\n"),
    eol: to,
  };
}
