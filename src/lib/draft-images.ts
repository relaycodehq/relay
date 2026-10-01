import type { Sketch } from "./sketch";

export interface DraftImage {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
  /** Its `[Image #n]` token in the draft; see image-refs. */
  n?: number;
  /** Ink drawn over the screenshot, burned in only when the message is sent. */
  sketch?: Sketch;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("relay-draft-images", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadDraftImages(key: string): Promise<DraftImage[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveDraftImages(
  key: string,
  images: DraftImage[],
): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite");
      if (images.length) transaction.objectStore("drafts").put(images, key);
      else transaction.objectStore("drafts").delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

const LIMIT = 800_000;
function asDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read screenshot."));
    reader.readAsDataURL(file);
  });
}
function jpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not compress screenshot.")),
      "image/jpeg",
      quality,
    ),
  );
}

export const isScreenshot = (file: File) =>
  ["image/png", "image/jpeg", "image/webp"].includes(file.type);
export async function prepareScreenshot(file: File): Promise<DraftImage> {
  if (!isScreenshot(file))
    throw new Error("Paste a PNG, JPEG or WebP screenshot.");
  if (!file.size || file.size > 12_000_000)
    throw new Error("Screenshot exceeds the 12 MB source limit.");
  let payload: Blob = file;
  let mimeType = file.type as DraftImage["mimeType"];
  if (file.size > LIMIT) {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not compress screenshot.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.88, 0.78, 0.66]) {
        payload = await jpeg(canvas, quality);
        if (payload.size <= LIMIT) break;
      }
      for (const factor of [0.75, 0.55]) {
        if (payload.size <= LIMIT) break;
        canvas.width = Math.max(1, Math.round(bitmap.width * scale * factor));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale * factor));
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        payload = await jpeg(canvas, 0.78);
      }
      if (payload.size > LIMIT)
        throw new Error("Screenshot is too large after compression.");
      mimeType = "image/jpeg";
    } finally {
      bitmap.close();
    }
  }
  return {
    id: crypto.randomUUID(),
    name: file.name || "Screenshot",
    mimeType,
    dataUrl: await asDataUrl(payload),
  };
}
