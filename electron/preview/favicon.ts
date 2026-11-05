import type { Session } from "electron";

const ICON_LIMIT = 1024 * 1024;
/** An icon still loading after this won't come; the next one is tried. */
const ICON_WAIT_MS = 10_000;

/** The first of a page's icons that loads, as a data URL; undefined when none does. */
export async function faviconData(session: Session, urls: string[]) {
  for (const url of urls) {
    const late = new AbortController();
    const timer = setTimeout(() => late.abort(), ICON_WAIT_MS);
    try {
      const response = await session.fetch(url, { signal: late.signal });
      if (!response.ok) continue;
      const mime = response.headers.get("content-type")?.split(";")[0];
      if (!mime?.startsWith("image/")) continue;
      const bytes = await bodyUpTo(response, ICON_LIMIT, late.signal);
      if (!bytes?.length) continue;
      return `data:${mime};base64,${bytes.toString("base64")}`;
    } catch {
      // Missing icons should never stop a page from loading.
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

/**
 * The response's body, or undefined as soon as it runs past `limit` bytes
 * or `late` aborts.
 */
async function bodyUpTo(response: Response, limit: number, late: AbortSignal) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const stop = () => void reader.cancel().catch(() => {});
  late.addEventListener("abort", stop, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (late.aborted) return undefined;
      if (done) return Buffer.concat(chunks);
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    late.removeEventListener("abort", stop);
  }
}
