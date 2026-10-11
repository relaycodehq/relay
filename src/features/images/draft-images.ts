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

const STORE = "drafts";

/** An IndexedDB request as a promise of its result. */
function requested<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

/** Settles once a write transaction has committed, or with why it didn't. */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = () => reject(transaction.error);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", failed);
    transaction.addEventListener("abort", failed);
  });
}

/** Opens the screenshots database for one piece of work in one transaction, and closes it after. */
async function withDrafts<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const opening = indexedDB.open("relay-draft-images", 1);
  opening.addEventListener("upgradeneeded", () =>
    opening.result.createObjectStore(STORE),
  );
  const db = await requested(opening);
  try {
    return await work(db.transaction(STORE, mode).objectStore(STORE));
  } finally {
    db.close();
  }
}

export const loadDraftImages = (key: string): Promise<DraftImage[]> =>
  withDrafts("readonly", (store) =>
    requested(store.get(key)).then((saved) => saved ?? []),
  );

/** Every draft key with screenshots saved. */
export const draftImageKeys = (): Promise<string[]> =>
  withDrafts("readonly", (store) =>
    requested(store.getAllKeys()).then((keys) => keys.map(String)),
  );

// How many screenshots without a pill each draft holds, so one with nothing
// else in it still counts as a draft. One with a pill counts through its
// text; with its pill deleted it is only kept for undo. Read from the store
// once, then kept as it's written.
const counts = new Map<string, number>();
// Written while the first read was out, so it doesn't bring back what's gone.
const written = new Set<string>();
const countListeners = new Set<(key: string) => void>();
let countsRead: Promise<void> | undefined;
const loose = (images: DraftImage[]) =>
  images.filter((image) => image.n === undefined).length;

function setCount(key: string, count: number) {
  if ((counts.get(key) ?? 0) === count) return;
  if (count) counts.set(key, count);
  else counts.delete(key);
  countListeners.forEach((notify) => notify(key));
}

/** Reads every draft's screenshot count, once; later calls wait on the same read. */
export const readDraftImageCounts = (): Promise<void> =>
  (countsRead ??= withDrafts("readonly", async (store) => {
    const [keys, values] = await Promise.all([
      requested(store.getAllKeys()),
      requested(store.getAll() as IDBRequest<DraftImage[][]>),
    ]);
    keys.forEach((key, i) => {
      if (!written.has(String(key)))
        setCount(String(key), loose(values[i] ?? []));
    });
  }).catch(() => {}));

/** How many screenshots without a pill the draft holds, as far as is known yet. */
export const draftImageCount = (key: string) => counts.get(key) ?? 0;
/** The drafts known to hold a screenshot without a pill. */
export const draftsWithImages = () => [...counts.keys()];

/** Told the draft key whose screenshot count changed. */
export function onDraftImageCount(notify: (key: string) => void) {
  countListeners.add(notify);
  return () => void countListeners.delete(notify);
}

/** Keeps a draft's screenshots; none clears its entry. */
export const saveDraftImages = (
  key: string,
  images: DraftImage[],
): Promise<void> =>
  withDrafts("readwrite", (store) => {
    if (images.length) store.put(images, key);
    else store.delete(key);
    return committed(store.transaction);
  }).then(() => {
    written.add(key);
    setCount(key, loose(images));
  });

/** The most a screenshot may weigh once stored. */
const LIMIT = 800_000;
/** A screenshot is drawn no longer than this on its long side before compressing. */
const LONG_SIDE = 2048;
/** Tried in order until one fits: quality goes first, then size. */
const attempts = [
  { size: 1, quality: 0.88 },
  { size: 1, quality: 0.78 },
  { size: 1, quality: 0.66 },
  { size: 0.75, quality: 0.78 },
  { size: 0.55, quality: 0.78 },
];

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

/** Re-encodes an image too heavy to keep as a JPEG under LIMIT, shrinking it if it must. */
async function shrink(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not compress screenshot.");
    const fit = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
    let drawnAt: number | undefined;
    for (const { size, quality } of attempts) {
      if (size !== drawnAt) {
        // Resizing clears the canvas; JPEG has no alpha, so paint white under it.
        canvas.width = Math.max(1, Math.round(bitmap.width * fit * size));
        canvas.height = Math.max(1, Math.round(bitmap.height * fit * size));
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        drawnAt = size;
      }
      const blob = await jpeg(canvas, quality);
      if (blob.size <= LIMIT) return blob;
    }
    throw new Error("Screenshot is too large after compression.");
  } finally {
    bitmap.close();
  }
}

export const isScreenshot = (file: File) =>
  ["image/png", "image/jpeg", "image/webp"].includes(file.type);
export async function prepareScreenshot(file: File): Promise<DraftImage> {
  if (!isScreenshot(file))
    throw new Error("Paste a PNG, JPEG or WebP screenshot.");
  if (!file.size || file.size > 12_000_000)
    throw new Error("Screenshot exceeds the 12 MB source limit.");
  const shrunk = file.size > LIMIT ? await shrink(file) : undefined;
  return {
    id: crypto.randomUUID(),
    name: file.name || "Screenshot",
    mimeType: shrunk ? "image/jpeg" : (file.type as DraftImage["mimeType"]),
    dataUrl: await asDataUrl(shrunk ?? file),
  };
}
