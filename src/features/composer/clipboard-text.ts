/** What one file on the clipboard is, as far as a paste can tell. */
export type ClipboardFile = { image: boolean; onDisk: boolean };

/** Whether the HTML still holds words once its tags are gone; a lone picture doesn't. */
function htmlHoldsWords(html: string) {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ");
  return text.trim().length > 0;
}

/**
 * Copying cells or a paragraph in Excel, Numbers, Word or PowerPoint puts the
 * text and a rendered picture of it on the clipboard; the text is what the
 * user means. A picture copied in a browser can come with its address, and
 * a file copied in the file manager with its name, and there the picture or
 * the file is what they mean. So the text wins only when the files are all
 * pictures with no place on disk and a rich form of the text came along.
 */
export function textIsTheContent({
  plain,
  html,
  rtf,
  files,
}: {
  plain: string;
  html: string;
  rtf: string;
  files: ClipboardFile[];
}) {
  if (!plain.trim()) return false;
  if (!files.every((file) => file.image && !file.onDisk)) return false;
  return rtf.trim().length > 0 || htmlHoldsWords(html);
}

export type TextPaste = "editor" | "insert" | "pill" | "file";

/**
 * Who puts pasted text in. The editor's own paste does it for text that
 * carries paste blocks or is short, but it steps aside whenever files are on
 * the clipboard, so then the composer inserts the text itself. A long text
 * goes in as a pill and a huge one as a file either way.
 */
export function textPasteRoute({
  hasFiles,
  hasBlocks,
  huge,
  long,
}: {
  hasFiles: boolean;
  hasBlocks: boolean;
  huge: boolean;
  long: boolean;
}): TextPaste {
  const byEditor = hasFiles ? "insert" : "editor";
  if (hasBlocks) return byEditor;
  if (huge) return "file";
  if (long) return "pill";
  return byEditor;
}
