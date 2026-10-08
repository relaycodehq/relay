import type { IncomingMessage, ServerResponse } from "node:http";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { createBrotliDecompress, createUnzip } from "node:zlib";

export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

// Skip comments, raw-text elements and attributes containing title-like text.
const attributes = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`;
const headTokens = new RegExp(
  [
    String.raw`<!--[\s\S]*?(?:-->|$)`,
    String.raw`<(script|style|textarea|xmp|iframe|noembed|noframes)\b${attributes}>[\s\S]*?(?:<\/\1\s*>|$)`,
    String.raw`(<title\b${attributes}>)([\s\S]*?)(<\/title\s*>)`,
    String.raw`(<\/head\s*>)`,
    String.raw`<${attributes}(?:>|(?:"[^"]*|'[^']*)?$)`,
  ].join("|"),
  "gi",
);

/** Buffer only the beginning of HTML, prefix its real title, then stream. */
export class TitlePrefix extends Transform {
  private text = "";
  private bytes = 0;
  private decoder = new StringDecoder("utf8");
  private tagged = false;
  constructor(private title: string) {
    super();
  }
  private flushTitle(force = true) {
    let complete = false;
    const text = this.text.replace(
      headTokens,
      (all, _raw, open, title, close, head) => {
        if (open && !complete) {
          complete = true;
          return `${open}${escapeHtml(`[${this.title}] `)}${title}${close}`;
        }
        if (head) complete = true;
        return all;
      },
    );
    if (!complete && !force) return;
    this.push(text);
    this.text = "";
    this.tagged = true;
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ) {
    if (this.tagged) this.push(this.decoder.write(chunk));
    else {
      this.text += this.decoder.write(chunk);
      this.bytes += chunk.length;
      this.flushTitle(this.bytes >= 64 * 1024);
    }
    done();
  }
  override _flush(done: (error?: Error | null) => void) {
    if (!this.tagged) {
      this.text += this.decoder.end();
      this.flushTitle();
    } else this.push(this.decoder.end());
    done();
  }
}

/** Preserve response semantics; scope cookies and local redirects to the named host. */
export async function forwardPreview(
  upstream: IncomingMessage,
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  title: string,
) {
  const headers = { ...upstream.headers };
  for (const header of [
    "connection",
    "keep-alive",
    "transfer-encoding",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade",
    ...(upstream.headers.connection ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase()),
  ])
    delete headers[header];
  if (headers["set-cookie"])
    headers["set-cookie"] = headers["set-cookie"].map((cookie) =>
      cookie.replace(/;\s*domain=[^;]*/gi, ""),
    );
  if (headers.location) {
    const origin = `http://localhost:${port}/`;
    const redirect = URL.parse(
      headers.location,
      URL.parse(req.url ?? "/", origin)?.href ?? origin,
    );
    if (
      redirect?.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname) &&
      Number(redirect.port || 80) === port
    )
      headers.location = `http://${req.headers.host}${redirect.pathname}${redirect.search}${redirect.hash}`;
  }
  const encoding = headers["content-encoding"]?.toLowerCase();
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i
    .exec(headers["content-type"] ?? "")?.[1]
    ?.toLowerCase();
  const html =
    req.method !== "HEAD" &&
    /\btext\/html\b/i.test(headers["content-type"] ?? "") &&
    (!charset || ["utf-8", "utf8", "us-ascii"].includes(charset)) &&
    (!encoding || ["identity", "gzip", "deflate", "br"].includes(encoding));
  if (html)
    for (const name of [
      "content-length",
      "content-encoding",
      "etag",
      "content-md5",
    ])
      delete headers[name];
  res.writeHead(upstream.statusCode ?? 502, headers);
  if (!html) return pipeline(upstream, res);
  if (encoding === "br")
    return pipeline(
      upstream,
      createBrotliDecompress(),
      new TitlePrefix(title),
      res,
    );
  if (encoding === "gzip" || encoding === "deflate")
    return pipeline(upstream, createUnzip(), new TitlePrefix(title), res);
  return pipeline(upstream, new TitlePrefix(title), res);
}
