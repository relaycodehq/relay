import { isScreenshot, type DraftImage } from "../images/draft-images";
import { sketchPng } from "../images/sketch";

/** GitHub takes images up to 10 MB; a little under leaves room. */
const limit = 9_500_000;

/**
 * An image to edit at full size. Unlike a chat's screenshots it isn't shrunk
 * first: a report's reader wants to read the text in it.
 */
export async function reportImage(file: File, name = file.name) {
  if (!isScreenshot(file))
    throw new Error("Add a PNG, JPEG or WebP screenshot.");
  if (file.size > 40_000_000)
    throw new Error("That image is over 40 MB; take a smaller screenshot.");
  return {
    id: crypto.randomUUID(),
    name: name.replace(/\.(png|jpe?g|webp)$/i, "") || "Screenshot",
    mimeType: file.type as DraftImage["mimeType"],
    dataUrl: await dataUrl(file),
  } satisfies DraftImage;
}

/**
 * The screenshot as the report keeps it: the drawing burned in and the whole
 * image drawn afresh as a PNG, so the source file's metadata and the pixels
 * under a black-out are gone. Shrinks until GitHub would take it.
 */
export async function reportPng(image: DraftImage) {
  for (let scale = 1; scale > 0.2; scale *= 0.8) {
    const blob = await sketchPng(image, scale);
    if (blob.size <= limit) return new Uint8Array(await blob.arrayBuffer());
  }
  throw new Error("That screenshot is too large, even made smaller.");
}

export const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
