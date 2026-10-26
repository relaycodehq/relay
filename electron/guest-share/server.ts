import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  guestSuggestionInput,
  type GuestPageView,
} from "../../shared/guest-share";
import { injectRenderBootstrap, RENDER_CSP } from "../../shared/html-render";
import { redacted } from "../../shared/redact-secrets";
import {
  baselineKey,
  baselineOf,
  emptyBaseline,
  guestDelta,
  type GuestBaseline,
} from "./delta";
import { guestPage } from "./page";
import {
  notFound,
  parseJson,
  readBody,
  SECURITY_HEADERS,
  sendBody,
  sendFile,
  sendJson,
} from "./respond";
import { guestBundle } from "./bundle";
import { sharedFileText, type SharedFile } from "./shared-files";
import type { GuestSnapshot } from "./snapshot";
import { guestVideo } from "./video";

/** What the server needs to know of a link. */
export interface ServedLink {
  token: string;
  threadId: string;
}

/** What the server asks of the shares; it knows tokens, never threads. */
export interface GuestServerHost<L extends ServedLink> {
  live(token: string): L | undefined;
  snapshot(link: L): Promise<GuestSnapshot>;
  page(link: L, guestId: string): Promise<GuestPageView>;
  /** Keeps a suggestion; a refusal in words, or undefined when it's kept. */
  suggest(
    link: L,
    input: { guestId: string; name: string; text: string },
  ): string | undefined;
  /** The live link and render a render's own address stands for. */
  render(key: string): { link: L; renderId: string } | undefined;
  renderPage(link: L, renderId: string, page: number): Promise<string>;
}

/** A link's token: an HMAC-SHA256, base64url. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Funnel may or may not strip its mount path, so a link is read from the end. */
const ROUTE = /\/g\/([A-Za-z0-9_-]{43})(\/[^?]*)?$/;
/** A render's page, at an address of its own: a page's scripts can read their URL. */
const RENDER_ROUTE = /\/r\/([A-Za-z0-9_-]{43})\/(\d+)$/;
const MAX_BODY_BYTES = 16 * 1024;
/** How often a guest's live connection looks for changes, and pings to stay open. */
const DELTA_MS = 1000;
const PING_MS = 20_000;

/**
 * The guests' side, on this computer's loopback only: Funnel is what puts it
 * on the internet. Every link is a token; anything else is a 404 that says
 * nothing about which links exist.
 */
export class GuestServer<L extends ServedLink> {
  private server?: Server;
  private listening?: Promise<void>;
  /** Pages' live connections, to tell them when their link is over. */
  private streams = new Set<ServerResponse>();
  /** What each page was served with, so its live connection sends only what changed. */
  private baselines = new Map<string, GuestBaseline>();
  /**
   * Files and bundles read and redacted once per snapshot, however often a
   * link's holder asks: that work runs on the main process.
   */
  private texts = new WeakMap<SharedFile, Promise<string | undefined>>();
  private bundles = new WeakMap<GuestSnapshot, Promise<string>>();

  constructor(private host: GuestServerHost<L>) {}

  get port() {
    return (this.server?.address() as AddressInfo | null)?.port;
  }

  /** Opens the server once; every caller waits until it's bound. */
  listen(port: number) {
    this.listening ??= this.bind(port).catch((e) => {
      this.server = undefined;
      this.listening = undefined;
      throw e;
    });
    return this.listening;
  }

  private async bind(port: number) {
    const server = createServer((req, res) => {
      this.respond(req, res).catch((e) => {
        console.warn("Guest share request failed:", e);
        if (!res.headersSent)
          sendJson(res, 500, { error: "Something went wrong." });
        else res.end();
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    }).catch(async (e: NodeJS.ErrnoException) => {
      // Someone else has the usual port; any free one will do for Funnel.
      if (e.code !== "EADDRINUSE") throw e;
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
    });
  }

  /** `ended` tells the pages still following a link that it's over before they're cut off. */
  async close({ ended = false } = {}) {
    const server = this.server;
    this.server = undefined;
    this.listening = undefined;
    if (!server) return;
    if (ended) await Promise.all([...this.streams].map(endStream));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  private async respond(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://guest.invalid");
    const page = url.pathname.match(RENDER_ROUTE);
    if (page && req.method === "GET") {
      const render = this.host.render(page[1]!);
      if (!render) return notFound(res);
      return this.render(render.link, render.renderId, Number(page[2]), res);
    }
    const match = url.pathname.match(ROUTE);
    const link = match && this.host.live(match[1]!);
    if (!link) return notFound(res);
    const segments = pathSegments(match![2] ?? "");
    if (!segments) return notFound(res);
    const [action = "", ...rest] = segments;
    const guestId = url.searchParams.get("guest") ?? "";
    if (req.method === "POST" && action === "suggest")
      return this.suggest(link, req, res);
    if (req.method !== "GET") return notFound(res);
    switch (action) {
      case "":
        return this.page(link, req, res);
      case "view":
        return sendBody(
          req,
          res,
          JSON.stringify(await this.host.page(link, guestId)),
          json,
        );
      case "events":
        return this.events(link, guestId, this.resumedFrom(req, url), res);
      case "file":
        return this.file(link, rest[0] ?? "", res);
      case "detail":
        return this.detail(link, rest.join("/"), req, res);
      case "media":
        return this.media(link, rest[0] ?? "", req, res);
      case "bundle":
        return sendBody(
          req,
          res,
          await this.bundle(await this.host.snapshot(link)),
          json,
        );
      default:
        return notFound(res);
    }
  }

  /** The page with the thread already in it, so it shows without another round trip. */
  private async page(link: L, req: IncomingMessage, res: ServerResponse) {
    const view = await this.host.page(link, "");
    // Named by its content, so every guest loading the same thread gets the
    // same page and its compressed copy is made once.
    const known = this.remember(baselineOf(view));
    const { html, csp } = guestPage({ view, known });
    return sendBody(req, res, html, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "X-Frame-Options": "DENY",
    });
  }

  /** Keeps what a guest's page holds, under a name its live connection can ask for. */
  private remember(baseline: GuestBaseline) {
    const key = baselineKey(baseline);
    this.baselines.delete(key);
    this.baselines.set(key, baseline);
    if (this.baselines.size > 200)
      this.baselines.delete(this.baselines.keys().next().value!);
    return key;
  }

  /**
   * What the page holds as its live connection opens: the last change it got
   * when it's reconnecting, else what it was served with.
   */
  private resumedFrom(req: IncomingMessage, url: URL) {
    const lastEvent = req.headers["last-event-id"];
    const key =
      (typeof lastEvent === "string" && lastEvent) ||
      url.searchParams.get("known") ||
      "";
    // An unknown one starts from nothing, so the page gets everything again.
    return this.baselines.get(key) ?? emptyBaseline();
  }

  /** Server-sent changes to the guest's page, a message at a time. */
  private events(
    link: L,
    guestId: string,
    from: GuestBaseline,
    res: ServerResponse,
  ) {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    });
    let baseline = from;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!this.host.live(link.token)) return void endStream(res);
        const change = guestDelta(
          baseline,
          await this.host.page(link, guestId),
        );
        if (!change) return;
        baseline = change.after;
        const id = this.remember(baseline);
        res.write(`id: ${id}\ndata: ${JSON.stringify(change.delta)}\n\n`);
      } catch (e) {
        console.warn("Guest share update failed:", e);
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), DELTA_MS);
    const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
    this.streams.add(res);
    res.on("close", () => {
      this.streams.delete(res);
      clearInterval(timer);
      clearInterval(ping);
    });
  }

  private async suggest(link: L, req: IncomingMessage, res: ServerResponse) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return sendJson(res, 415, { error: "Send JSON." });
    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === undefined)
      return sendJson(res, 413, { error: "That's too long." });
    const input = guestSuggestionInput.safeParse(parseJson(raw));
    if (!input.success) {
      // A rule of ours says what's wrong in words; zod's own don't.
      const ours = input.error.issues.find((issue) => issue.code === "custom");
      return sendJson(res, 400, {
        error: ours?.message ?? "Write a name and a message.",
      });
    }
    const refused = this.host.suggest(link, input.data);
    if (refused) return sendJson(res, 429, { error: refused });
    sendJson(res, 200, { ok: true });
  }

  private async file(link: L, id: string, res: ServerResponse) {
    const file = (await this.host.snapshot(link)).files.get(id);
    if (!file) return notFound(res);
    const text = await this.fileText(file);
    if (text === undefined) return notFound(res);
    res.writeHead(200, { ...SECURITY_HEADERS, ...plain });
    res.end(text);
  }

  private fileText(file: SharedFile) {
    let text = this.texts.get(file);
    if (!text) {
      text = sharedFileText(file).catch(() => undefined);
      this.texts.set(file, text);
    }
    return text;
  }

  private bundle(snapshot: GuestSnapshot) {
    let bundle = this.bundles.get(snapshot);
    if (!bundle) {
      bundle = guestBundle(snapshot).then((b) => JSON.stringify(b));
      this.bundles.set(snapshot, bundle);
      // A failed read is tried again by the next request.
      bundle.catch(() => this.bundles.delete(snapshot));
    }
    return bundle;
  }

  private async detail(
    link: L,
    key: string,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const detail = (await this.host.snapshot(link)).details.get(key);
    if (detail === undefined) return notFound(res);
    return sendBody(req, res, detail, plain);
  }

  private async media(
    link: L,
    id: string,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const source = (await this.host.snapshot(link)).media.get(id);
    if (!source) return notFound(res);
    if (source.kind === "video") {
      const original = await source.path().catch(() => undefined);
      const playable = original && (await guestVideo(original));
      if (!playable) return notFound(res);
      return sendFile(req, res, playable, "video/mp4");
    }
    const dataUrl = await source.dataUrl().catch(() => undefined);
    const parsed =
      dataUrl &&
      /^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/.exec(dataUrl);
    if (!parsed) return notFound(res);
    const bytes = Buffer.from(parsed[2]!, "base64");
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": parsed[1]!,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=3600",
    });
    res.end(bytes);
  }

  /** A show_html page, sandboxed by its own CSP as it is in the app. */
  private async render(
    link: L,
    renderId: string,
    page: number,
    res: ServerResponse,
  ) {
    const pages = (await this.host.snapshot(link)).renders.get(renderId);
    if (!pages || !Number.isInteger(page) || page < 0 || page >= pages)
      return notFound(res);
    const html = await this.host
      .renderPage(link, renderId, page)
      .catch(() => undefined);
    if (html === undefined) return notFound(res);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": RENDER_CSP,
      "Cache-Control": "no-store",
    });
    res.end(injectRenderBootstrap(redacted(html)));
  }
}

/** Tells the page its link is over; settles once that's sent, or soon if the guest isn't reading. */
function endStream(res: ServerResponse) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 1000).unref();
    if (res.writableEnded) return resolve();
    res.end("event: ended\ndata: {}\n\n", resolve);
  });
}

/** The route's parts, decoded; undefined when one isn't valid percent-encoding. */
function pathSegments(path: string) {
  try {
    return path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return undefined;
  }
}

const json = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

const plain = {
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8",
};
