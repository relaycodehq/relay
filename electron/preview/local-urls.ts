import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { createProxyServer } from "httpxy";
import { escapeHtml as escape, forwardPreview } from "./proxy-html";

export const PREVIEW_PROXY_PORT = 1377;
/** Only explicit HTTP loopback URLs become named worktree routes. */
export function localPort(url: string): number | undefined {
  const parsed = URL.parse(url);
  if (
    parsed?.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  )
    return;
  return Number(parsed.port || 80);
}
export interface LocalPreview {
  folder: string;
  project: string;
  branch?: string;
  /** Separate simultaneous HTTP services in one folder. */
  service?: number;
  port: number;
  wake: () => Promise<unknown>;
  screenshot?: () => Buffer | undefined;
  active?: () => boolean;
}
const label = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/g, "") || "project";
/** Folder identity distinguishes equal names without coupling the hostname to its port. */
export function previewHost(
  target: Pick<LocalPreview, "folder" | "project" | "branch" | "service">,
) {
  const id = createHash("sha256")
    .update(target.folder)
    .digest("hex")
    .slice(0, 8);
  return `${target.service ? `p-${target.service}.` : ""}${label(target.branch ?? "checkout")}-${id}.${label(target.project)}.relay.localhost`;
}
/** Loopback-only HTTP/WebSocket bridge for explicitly registered worktree servers. */
export class LocalUrls {
  private routes = new Map<string, LocalPreview>();
  private requests = new WeakMap<IncomingMessage, LocalPreview>();
  private sockets = new Set<Socket>();
  private proxy = createProxyServer({
    changeOrigin: true,
    xfwd: true,
    selfHandleResponse: true,
  });
  private server = createServer((req, res) => void this.request(req, res));
  private starting?: Promise<number>;
  private port?: number;
  private disposed = false;
  constructor(private requestedPort = PREVIEW_PROXY_PORT) {
    this.proxy.on("proxyRes", (response, req, res) => {
      const route = this.requests.get(req);
      if (!route) return response.destroy();
      void forwardPreview(
        response,
        req,
        res,
        route.port,
        route.branch ?? route.project,
      ).catch(() => res.destroy());
    });
    this.server.on("connection", (socket) => this.track(socket));
    this.proxy.on("open", (socket) => this.track(socket));
    this.server.on("upgrade", (req, socket, head) => {
      const route = this.routes.get(this.host(req) ?? "");
      if (!route) return socket.destroy();
      this.clearForwarded(req);
      void route
        .wake()
        .then(() => {
          if (this.disposed || socket.destroyed || route.port === this.port) {
            socket.destroy();
            return;
          }
          return this.proxy.ws(
            req,
            socket as Socket,
            { target: `http://localhost:${route.port}` },
            head,
          );
        })
        .catch(() => socket.destroy());
    });
    this.server.on("clientError", (_error, socket) => socket.destroy());
  }
  register(target: LocalPreview) {
    if (
      !Number.isInteger(target.port) ||
      target.port < 1 ||
      target.port > 65535
    )
      throw new Error("The preview's dev port must be between 1 and 65535.");
    if (target.port === this.port || target.port === this.requestedPort)
      throw new Error("A preview cannot route back to Relay's own proxy port.");
    // The first service keeps the folder's name. Once issued, that name is
    // reserved for its port, even while that service is down. Later services
    // keep their own names when the folder returns to a single listener.
    const primaryHost = previewHost({ ...target, service: undefined });
    const specificHost = previewHost({ ...target, service: target.port });
    const primary = this.routes.get(primaryHost);
    if (primary?.port === target.port) target.service = undefined;
    else if (primary || this.routes.has(specificHost))
      target.service = target.port;
    const host = previewHost(target),
      previous = this.routes.get(host);
    if (previous && previous.folder !== target.folder)
      throw new Error("Two preview folders have the same local URL.");
    target.screenshot ??= previous?.screenshot;
    const port = target.port;
    this.routes.set(host, {
      ...target,
      wake: async () => {
        await target.wake();
        if (target.port !== port)
          throw new Error(
            "An existing preview URL cannot change its upstream port.",
          );
      },
    });
    return host;
  }
  async url(target: LocalPreview) {
    const host = this.register(target),
      port = await this.start();
    if (target.port === port)
      throw new Error("A preview cannot route back to Relay's own proxy port.");
    return `http://${host}:${port}/`;
  }
  async indexUrl() {
    return `http://relay.localhost:${await this.start()}/`;
  }
  private start(): Promise<number> {
    if (this.disposed)
      return Promise.reject(new Error("Relay's preview proxy has closed."));
    if (this.port !== undefined) return Promise.resolve(this.port);
    return (this.starting ??= new Promise<number>((resolve, reject) => {
      const failed = (error: NodeJS.ErrnoException) => {
        this.starting = undefined;
        reject(
          new Error(
            error.code === "EADDRINUSE"
              ? `Relay's preview URL port ${this.requestedPort} is already in use. Free that port and try again.`
              : `Relay couldn't start its preview URL proxy: ${error.message}`,
          ),
        );
      };
      this.server.once("error", failed);
      this.server.listen(this.requestedPort, "127.0.0.1", () => {
        this.server.off("error", failed);
        if (this.disposed) {
          this.server.close();
          reject(new Error("Relay's preview proxy has closed."));
          return;
        }
        this.port = (this.server.address() as { port: number }).port;
        resolve(this.port);
      });
    }));
  }
  private host(req: IncomingMessage) {
    const host = req.headers.host;
    if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return;
    return host.split(":")[0]!.toLowerCase();
  }
  private async request(req: IncomingMessage, res: ServerResponse) {
    const host = this.host(req),
      route = this.routes.get(host ?? "");
    if (!route) {
      if (["relay.localhost", "localhost", "127.0.0.1"].includes(host ?? "")) {
        if (req.url === "/") return this.index(res);
        const match = /^\/_relay\/screenshots\/([a-z0-9.-]+)$/.exec(
          req.url ?? "",
        );
        const image = match && this.routes.get(match[1]!)?.screenshot?.();
        if (image) {
          res.writeHead(200, {
            "content-type": "image/jpeg",
            "cache-control": "no-store",
          });
          return res.end(image);
        }
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("No Relay preview has opened this local URL yet.");
    }
    try {
      await route.wake();
      if (this.disposed || res.destroyed) return res.destroy();
      if (route.port === this.port)
        throw new Error("A preview cannot route to its own proxy.");
      this.requests.set(req, { ...route });
      this.clearForwarded(req);
      await this.proxy.web(req, res, {
        target: `http://localhost:${route.port}`,
      });
    } catch {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        `The dev server for ${route.project}${route.branch ? ` (${route.branch})` : ""} isn't answering on port ${route.port}. Start it, then reload this page.`,
      );
    }
  }
  private clearForwarded(req: IncomingMessage) {
    for (const header of [
      "x-forwarded-host",
      "x-forwarded-for",
      "x-forwarded-proto",
      "x-forwarded-port",
    ])
      delete req.headers[header];
  }
  private index(res: ServerResponse) {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    });
    const rows = [...this.routes]
      .filter(([, route]) => route.active?.() !== false)
      .map(
        ([host, route]) =>
          `<li><a href="http://${host}:${this.port}/">${route.screenshot?.() ? `<img src="/_relay/screenshots/${host}" alt="Last preview of ${escape(route.branch ?? route.project)}">` : '<span class="placeholder">No screenshot yet</span>'}<strong>${escape(route.project)}</strong> · ${escape(route.branch ?? "Project folder")}</a><small>${escape(host)}:${this.port} → :${route.port}</small></li>`,
      )
      .join("");
    res.end(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Relay previews</title><style>html{color-scheme:light dark;font:15px system-ui}body{max-width:1000px;margin:64px auto;padding:0 24px}h1{font-size:26px}p,small{opacity:.7}ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:24px}li{min-width:0;overflow-wrap:anywhere;padding:16px;border:1px solid #8884;border-radius:12px}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}img,.placeholder{display:block;width:100%;height:200px;object-fit:cover;object-position:top;background:#8881;border-radius:6px;margin-bottom:16px}.placeholder{display:grid;place-items:center;color:#888}small{display:block;margin-top:8px;overflow-wrap:anywhere}</style></head><body><h1>Relay previews</h1><p>The project folders and worktrees opened in this Relay session. Screenshots show the last captured frame.</p><ul>${rows || "<li>Open a Browser surface in Relay to add its preview here.</li>"}</ul></body></html>`,
    );
  }
  dispose() {
    this.disposed = true;
    this.routes.clear();
    for (const socket of this.sockets) socket.destroy();
    if (this.port !== undefined) this.server.close();
    this.proxy.close();
    this.port = undefined;
    this.starting = undefined;
  }
  private track(socket: Socket) {
    if (this.disposed) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
  }
}
