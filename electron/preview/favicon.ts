import type { Session } from "electron";

/** The first of a page's icons that loads, as a data URL; undefined when none does. */
export async function faviconData(session: Session, urls: string[]) {
  for (const url of urls) {
    try {
      const response = await session.fetch(url);
      if (!response.ok) continue;
      const mime = response.headers.get("content-type")?.split(";")[0];
      if (!mime?.startsWith("image/")) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 1024 * 1024) continue;
      return `data:${mime};base64,${bytes.toString("base64")}`;
    } catch {
      // Missing icons should never stop a page from loading.
    }
  }
  return undefined;
}
