import { readFile, stat } from "node:fs/promises";

/** The image type the bytes start with, whatever the file is called. */
export function imageMimeType(bytes: Buffer) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (/^GIF8[79]a/.test(bytes.toString("ascii", 0, 6))) return "image/gif";
}

/** An image file on disk as a data URL, if it is one Relay can show. */
export async function imageFileData(path: string) {
  const { size } = await stat(path).catch((e: NodeJS.ErrnoException) => {
    throw e.code === "ENOENT"
      ? new Error("That image is no longer on disk.")
      : e;
  });
  if (size > 30_000_000) throw new Error("That image is too large to preview.");
  const bytes = await readFile(path);
  const mimeType = imageMimeType(bytes);
  if (!mimeType) throw new Error("That file isn't an image Relay can show.");
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}
