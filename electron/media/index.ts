// relay-media://: serves video and picture files the renderer was allowed to, streamed
// with byte ranges so a player can seek without reading the whole file.
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { protocol, session } from "electron";
import { imageMime, videoMime } from "../../shared/project-files";

const SCHEME = "relay-media";

/** A raster picture's type; an SVG stays a download, since one opened as a page runs its scripts. */
const picture = (path: string) => {
  const mime = imageMime(path);
  return mime && mime !== "image/svg+xml" ? mime : undefined;
};

/** Before the app is ready: a player needs a streaming, fetchable scheme. */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

// Only files a caller checked get a token, so a page can't name any other.
const byToken = new Map<string, string>();
const byPath = new Map<string, string>();

/** The address the renderer plays `full` from; call only once the caller checked it may. */
export function mediaUrl(full: string) {
  let token = byPath.get(full);
  if (!token) {
    token = randomUUID();
    byToken.set(token, full);
    byPath.set(full, token);
  }
  return `${SCHEME}://file/${token}/${encodeURIComponent(basename(full))}`;
}

/** The bytes `header` asks for out of `size`, or null when it asks for none we have. */
export function byteRange(header: string | null, size: number) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end, partial: true } : null;
}

export function serveMedia() {
  session.defaultSession.protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const full =
      url.host === "file"
        ? byToken.get(url.pathname.split("/")[1] ?? "")
        : undefined;
    const info = full ? await stat(full).catch(() => null) : null;
    if (!full || !info?.isFile())
      return new Response("Not found", { status: 404 });
    const headers = {
      "content-type":
        videoMime(full) ?? picture(full) ?? "application/octet-stream",
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    };
    const range = byteRange(request.headers.get("range"), info.size);
    if (!range)
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-range": `bytes */${info.size}` },
      });
    const body = Readable.toWeb(
      createReadStream(full, { start: range.start, end: range.end }),
    );
    return new Response(body as ReadableStream, {
      status: range.partial ? 206 : 200,
      headers: {
        ...headers,
        "content-length": String(range.end - range.start + 1),
        ...(range.partial && {
          "content-range": `bytes ${range.start}-${range.end}/${info.size}`,
        }),
      },
    });
  });
}
