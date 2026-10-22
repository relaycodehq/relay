// relay-media://: serves video and picture files the renderer was allowed to, streamed
// with byte ranges so a player can seek without reading the whole file.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { within } from "../util/paths";
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

interface Grant {
  root: string;
  full: string;
}
// Only files a caller checked get a token, so a page can't name any other.
const byToken = new Map<string, Grant>();
const byPath = new Map<string, string>();

/** Open once, validate the opened file, and stream that handle rather than reopening a checked path. */
async function openGranted({ root, full }: Grant) {
  if ((await realpath(root)) !== root || (await realpath(full)) !== full)
    throw new Error("The media path changed.");
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    const [current, entry] = await Promise.all([realpath(full), lstat(full)]);
    if (
      current !== full ||
      !info.isFile() ||
      info.nlink !== 1 ||
      !entry.isFile() ||
      entry.nlink !== 1 ||
      info.dev !== entry.dev ||
      info.ino !== entry.ino
    )
      throw new Error("Choose a regular, unlinked media file.");
    return { handle, info };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** A checked file inside its approved root; later requests revalidate the same boundary. */
export async function mediaUrl(full: string, root: string) {
  const path = within(root, full);
  if (!isAbsolute(root) || !isAbsolute(full) || !path)
    throw new Error("Choose media inside its approved folder.");
  const canonicalRoot = await realpath(root);
  const grant = { root: canonicalRoot, full: join(canonicalRoot, path) };
  const { handle } = await openGranted(grant);
  await handle.close();
  const key = `${grant.root}\0${grant.full}`;
  let token = byPath.get(key);
  if (!token) {
    token = randomUUID();
    byToken.set(token, grant);
    byPath.set(key, token);
  }
  return `${SCHEME}://file/${token}/${encodeURIComponent(basename(full))}`;
}

/** The bytes `header` asks for out of `size`, or null when it asks for none we have. */
export function byteRange(header: string | null, size: number) {
  if (!size) return null;
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
    const grant =
      url.host === "file"
        ? byToken.get(url.pathname.split("/")[1] ?? "")
        : undefined;
    const opened = grant ? await openGranted(grant).catch(() => null) : null;
    if (!grant || !opened) {
      console.warn(
        `relay-media: no file for ${url.pathname} (${grant?.full ?? "unknown token"})`,
      );
      return new Response("Not found", { status: 404 });
    }
    const { full } = grant;
    const { handle, info } = opened;
    const headers = {
      "content-type":
        videoMime(full) ?? picture(full) ?? "application/octet-stream",
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    };
    const requested = request.headers.get("range");
    if (!info.size && !requested) {
      await handle.close();
      return new Response(null, {
        headers: { ...headers, "content-length": "0" },
      });
    }
    const range = byteRange(requested, info.size);
    if (!range) {
      await handle.close();
      console.warn(
        `relay-media: range ${request.headers.get("range")} outside ${info.size} bytes of ${full}`,
      );
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-range": `bytes */${info.size}` },
      });
    }
    const responseHeaders = {
      ...headers,
      "content-length": String(range.end - range.start + 1),
      ...(range.partial && {
        "content-range": `bytes ${range.start}-${range.end}/${info.size}`,
      }),
    };
    if (request.method === "HEAD") {
      await handle.close();
      return new Response(null, {
        status: range.partial ? 206 : 200,
        headers: responseHeaders,
      });
    }
    let file;
    try {
      file = handle.createReadStream({
        start: range.start,
        end: range.end,
        autoClose: true,
      });
    } catch (error) {
      await handle.close();
      throw error;
    }
    const abort = () => file.destroy();
    request.signal.addEventListener("abort", abort, { once: true });
    file.once("close", () =>
      request.signal.removeEventListener("abort", abort),
    );
    if (request.signal.aborted) abort();
    file.on("error", (error: NodeJS.ErrnoException) => {
      // Players cancel a range after reading metadata or seeking elsewhere.
      if (error.code !== "ABORT_ERR")
        console.warn(`relay-media: reading ${full} failed:`, error);
    });
    const body = Readable.toWeb(file);
    return new Response(body as ReadableStream, {
      status: range.partial ? 206 : 200,
      headers: responseHeaders,
    });
  });
}
