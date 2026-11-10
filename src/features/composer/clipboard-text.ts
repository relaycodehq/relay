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
