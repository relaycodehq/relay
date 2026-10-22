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
const METADATA = "metadata";

/** Enough to count attachments and match their pills, without reading pixels or ink. */
export interface DraftImageMetadata {
  numbers: (number | undefined)[];
  loose: number;
}

const metadataOf = (images: DraftImage[]): DraftImageMetadata => ({
  numbers: images.map((image) => image.n),
  loose: images.filter((image) => image.n === undefined).length,
});

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
    const failed = () =>
      reject(
        transaction.error ??
          new Error("Screenshot storage transaction aborted."),
      );
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", failed);
    transaction.addEventListener("abort", failed);
  });
}

/** Opens the screenshots database for one piece of work in one transaction, and closes it after. */
async function withDrafts<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const opening = indexedDB.open("relay-draft-images", 2);
  opening.addEventListener("upgradeneeded", () => {
    const db = opening.result;
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    const metadata = db.createObjectStore(METADATA);
    // Upgrade atomically: every existing payload stays byte-for-byte intact,
    // including screenshots kept for undo and their editable sketches.
    const cursor = opening.transaction!.objectStore(STORE).openCursor();
    cursor.addEventListener("success", () => {
      const row = cursor.result;
      if (!row) return;
      metadata.put(metadataOf(row.value as DraftImage[]), row.key);
      row.continue();
    });
  });
  const db = await requested(opening);
  db.addEventListener("versionchange", () => db.close());
  try {
    const transaction = db.transaction(stores, mode);
    const finished = committed(transaction);
    // A request can reject before its transaction does; both are observed.
    void finished.catch(() => {});
    try {
      const result = await work(transaction);
      await finished;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* Already settled. */
      }
      await finished.catch(() => {});
      throw error;
    }
  } finally {
    db.close();
  }
}

export const loadDraftImages = (key: string): Promise<DraftImage[]> =>
  withDrafts([STORE], "readonly", (transaction) =>
    requested(transaction.objectStore(STORE).get(key)).then(
      (saved) => saved ?? [],
    ),
  );

/** Every draft key with screenshots saved. */
export const draftImageKeys = (): Promise<string[]> =>
  withDrafts([STORE], "readonly", (transaction) =>
    requested(transaction.objectStore(STORE).getAllKeys()).then((keys) =>
      keys.map(String),
    ),
  );

// How many screenshots without a pill each draft holds, so one with nothing
// else in it still counts as a draft. One with a pill counts through its
// text; with its pill deleted it is only kept for undo. Read from the store
// once, then kept as it's written.
const counts = new Map<string, number>();
const metadata = new Map<string, DraftImageMetadata>();
// Written while the first read was out, so it doesn't bring back what's gone.
const written = new Set<string>();
const countListeners = new Set<(key: string) => void>();
const metadataListeners = new Set<
  (key: string, value: DraftImageMetadata | undefined) => void
>();
let metadataRead: Promise<ReadonlyMap<string, DraftImageMetadata>> | undefined;

function setCount(key: string, count: number) {
  if ((counts.get(key) ?? 0) === count) return;
  if (count) counts.set(key, count);
  else counts.delete(key);
  countListeners.forEach((notify) => notify(key));
}

function setMetadata(key: string, value: DraftImageMetadata | undefined) {
  if (value) metadata.set(key, value);
  else metadata.delete(key);
  setCount(key, value?.loose ?? 0);
  metadataListeners.forEach((notify) => notify(key, value));
}

/** One small startup snapshot shared by Activity counts and draft synchronization. */
export function readDraftImageMetadata(): Promise<
  ReadonlyMap<string, DraftImageMetadata>
> {
  changes();
  return (metadataRead ??= withDrafts(
    [METADATA],
    "readonly",
    async (transaction) => {
      const store = transaction.objectStore(METADATA);
      const [keys, values] = await Promise.all([
        requested(store.getAllKeys()),
        requested(store.getAll() as IDBRequest<DraftImageMetadata[]>),
      ]);
      keys.forEach((key, i) => {
        if (!written.has(String(key))) setMetadata(String(key), values[i]);
      });
      return metadata;
    },
  ).catch((error) => {
    metadataRead = undefined;
    throw error;
  }));
}

/** Reads counts without bringing every draft's screenshots into the window. */
export const readDraftImageCounts = (): Promise<void> =>
  readDraftImageMetadata()
    .then(() => {})
    .catch(() => {});

/** Metadata changes here or in another window, after their storage write commits. */
export function onDraftImageMetadata(
  listener: (key: string, value: DraftImageMetadata | undefined) => void,
) {
  metadataListeners.add(listener);
  changes();
  return () => void metadataListeners.delete(listener);
}

/** How many screenshots without a pill the draft holds, as far as is known yet. */
export const draftImageCount = (key: string) => counts.get(key) ?? 0;
/** The drafts known to hold a screenshot without a pill. */
export const draftsWithImages = () => [...counts.keys()];

/** Told the draft key whose screenshot count changed. */
export function onDraftImageCount(notify: (key: string) => void) {
  countListeners.add(notify);
  return () => void countListeners.delete(notify);
}

// Thread windows share the database; each tells the others which draft it
// changed. A channel never hears its own messages, so a window isn't told its own.
let channel: BroadcastChannel | undefined;
function changes() {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel("relay-draft-images");
  // Another window's screenshots count in this one's Activity too.
  channel.addEventListener("message", ({ data: key }: MessageEvent) => {
    if (typeof key !== "string") return;
    written.add(key);
    void withDrafts([METADATA], "readonly", (transaction) =>
      requested(
        transaction.objectStore(METADATA).get(key) as IDBRequest<
          DraftImageMetadata | undefined
        >,
      ),
    )
      .then((value) => setMetadata(key, value))
      .catch(() => {});
  });
  return channel;
}

/** Calls `listener` with the draft key another window saved screenshots for. */
export function onDraftImagesChanged(listener: (key: string) => void) {
  const heard = (event: MessageEvent) => {
    if (typeof event.data === "string") listener(event.data);
  };
  changes()?.addEventListener("message", heard);
  return () => changes()?.removeEventListener("message", heard);
}

const savedListeners = new Set<(key: string, images: DraftImage[]) => void>();
/** Told each draft this window saved screenshots for, with what it holds now. */
export function onDraftImagesSaved(
  listener: (key: string, images: DraftImage[]) => void,
) {
  savedListeners.add(listener);
  return () => void savedListeners.delete(listener);
}

/** Keeps a draft's screenshots; none clears its entry. */
export const saveDraftImages = (
  key: string,
  images: DraftImage[],
): Promise<void> =>
  withDrafts([STORE, METADATA], "readwrite", (transaction) => {
    const store = transaction.objectStore(STORE);
    const metadata = transaction.objectStore(METADATA);
    const value = images.length ? metadataOf(images) : undefined;
    if (value) {
      store.put(images, key);
      metadata.put(value, key);
    } else {
      store.delete(key);
      metadata.delete(key);
    }
    return value;
  }).then((value) => {
    written.add(key);
    setMetadata(key, value);
    changes()?.postMessage(key);
    savedListeners.forEach((listener) => listener(key, images));
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
