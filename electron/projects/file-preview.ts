import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  filePreviewCharacters,
  filePreviewLines,
  type FilePreview,
} from "../../shared/project-files";
import {
  NotText,
  safeWorkingPath,
  textLimit,
  tooLarge,
} from "../git/working-files";

/** A mention's excerpt: no Git metadata, whole-file string or content hash. */
export async function filePreview(
  root: string,
  path: string,
): Promise<FilePreview> {
  const full = await safeWorkingPath(root, path);
  const handle = await open(
    full,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error("This file no longer exists.");
    throw error;
  });
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error("Choose a regular, unlinked file.");
    if (stat.size > textLimit) throw new NotText(tooLarge);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const bytes = Buffer.alloc(16 * 1024);
    let contents = "",
      lines = 1,
      shownLines = 1,
      length = 0,
      truncated = false;
    const consume = (text: string) => {
      lines += text.match(/\n/g)?.length ?? 0;
      if (truncated) return;
      let end = text.length,
        from = 0;
      for (let i = shownLines; i <= filePreviewLines; i++) {
        const next = text.indexOf("\n", from);
        if (next === -1) break;
        if (i === filePreviewLines) {
          end = next;
          truncated = true;
          break;
        }
        from = next + 1;
      }
      const piece = text
        .slice(0, end)
        .slice(0, filePreviewCharacters - contents.length);
      contents += piece;
      shownLines += piece.match(/\n/g)?.length ?? 0;
      if (piece.length < end) truncated = true;
    };
    while (true) {
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, length);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > textLimit) throw new NotText(tooLarge);
      const chunk = bytes.subarray(0, bytesRead);
      if (chunk.includes(0))
        throw new NotText("Binary files are not supported here.");
      try {
        consume(decoder.decode(chunk, { stream: true }));
      } catch {
        throw new NotText(
          "This file is not valid UTF-8. Edit it in your IDE to preserve its encoding.",
        );
      }
    }
    try {
      consume(decoder.decode());
    } catch {
      throw new NotText(
        "This file is not valid UTF-8. Edit it in your IDE to preserve its encoding.",
      );
    }
    if (contents.startsWith("version https://git-lfs.github.com/spec/v1"))
      throw new NotText("Git LFS files must be edited in your IDE.");
    // A character limit must not leave half of a UTF-16 surrogate pair.
    contents = contents.replace(/[\uD800-\uDBFF]$/, "");
    return { contents, lines, truncated };
  } finally {
    await handle.close();
  }
}
