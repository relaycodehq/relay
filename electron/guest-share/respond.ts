import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

export const SECURITY_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

/** Bodies under this go out as they are; compressing them saves nothing. */
const COMPRESS_FROM = 1024;

// The same body is compressed once per encoding, off the main thread, however
// many guests fetch it. Keyed by its hash, so a changed thread is a new entry.
const compressed = new Map<string, Promise<Buffer>>();
const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/**
 * Sends `body` brotli-compressed where the browser takes it (all current
 * ones do), gzip otherwise, with an ETag so an unchanged one is a 304.
 */
export async function sendBody(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
  headers: Record<string, string>,
) {
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ...SECURITY_HEADERS, ...headers, ETag: etag });
    return void res.end();
  }
  const raw = Buffer.from(body);
  const encoding = encodingFor(
    String(req.headers["accept-encoding"] ?? ""),
    raw.length,
  );
  const sent = encoding ? await compressedBody(etag, raw, encoding) : raw;
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    ...headers,
    ETag: etag,
    Vary: "Accept-Encoding",
    "Content-Length": String(sent.length),
    ...(encoding ? { "Content-Encoding": encoding } : {}),
  });
  res.end(sent);
}

function encodingFor(accepts: string, size: number) {
  if (size < COMPRESS_FROM) return undefined;
  if (accepts.includes("br")) return "br";
  if (accepts.includes("gzip")) return "gzip";
  return undefined;
}

function compressedBody(etag: string, raw: Buffer, encoding: "br" | "gzip") {
  const key = `${encoding}:${etag}`;
  const cached = compressed.get(key);
  if (cached) return cached;
  const made =
    encoding === "br"
      ? brotliAsync(raw, {
          params: {
            // 11 costs ~1ms per KB; past 64KB, 9 is within a few percent at a fraction of it.
            [constants.BROTLI_PARAM_QUALITY]: raw.length > 64 * 1024 ? 9 : 11,
            [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
          },
        })
      : gzipAsync(raw, { level: 9 });
  made.catch(() => compressed.delete(key));
  if (compressed.size >= 64) compressed.delete(compressed.keys().next().value!);
  compressed.set(key, made);
  return made;
}

/** A file with byte ranges, so a video seeks without downloading all of it. */
export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  type: string,
) {
  const { size } = await stat(path);
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (!range) {
    res.writeHead(200, { ...headers, "Content-Length": String(size) });
    return streamFile(path, res);
  }
  const start = range[1]
    ? Number(range[1])
    : Math.max(0, size - Number(range[2]));
  const end =
    range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
    return void res.end();
  }
  res.writeHead(206, {
    ...headers,
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": String(end - start + 1),
  });
  streamFile(path, res, { start, end });
}

/** Streams the file, closing both ends when either fails or the guest goes. */
function streamFile(
  path: string,
  res: ServerResponse,
  range?: { start: number; end: number },
) {
  pipeline(createReadStream(path, range), res, (e) => {
    // A guest seeking or leaving closes the response early.
    if (e && e.code !== "ERR_STREAM_PREMATURE_CLOSE")
      console.warn("Guest share file failed:", e);
  });
}

export function sendJson(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

export function notFound(res: ServerResponse) {
  res.writeHead(404, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("This link has ended.");
}

/** The request's body, or undefined past `max` bytes. */
export function readBody(req: IncomingMessage, max: number) {
  return new Promise<string | undefined>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const collect = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= max) return void chunks.push(chunk);
      // Drained unread, so the refusal can still be answered.
      req.off("data", collect);
      req.resume();
      resolve(undefined);
    };
    req.on("data", collect);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
