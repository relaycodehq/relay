import { createServer, request, type Server } from "node:http";
import { once } from "node:events";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { LocalUrls, previewHost, type LocalPreview } from "./local-urls";

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn()),
);
async function listen(server: Server) {
  cleanup.push(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}
const target = (
  port: number,
  patch: Partial<LocalPreview> = {},
): LocalPreview => ({
  folder: "/worktrees/fix-login",
  project: "Autago",
  branch: "fix-login",
  port,
  wake: async () => {},
  ...patch,
});
function proxy(port = 0) {
  const p = new LocalUrls(port);
  cleanup.push(() => p.dispose());
  return p;
}
function get(
  url: string,
  options: { method?: string; body?: string; host?: string } = {},
) {
  const parsed = new URL(url);
  return new Promise<{
    status: number;
    headers: import("node:http").IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: {
          host: options.host ?? parsed.host,
          "x-forwarded-host": "forged.invalid",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error("Proxy timed out")));
    req.on("error", reject);
    req.end(options.body);
  });
}
describe("LocalUrls", () => {
  it("keeps names stable across ports and separates equal slugs in different folders", () => {
    const a = target(3000, {
      branch: "feat/how it works",
      project: "Autago next.js",
    });
    expect(previewHost(a)).toMatch(
      /^feat-how-it-works-[a-f0-9]{8}\.autago-next-js\.relay\.localhost$/,
    );
    const b = { ...a, port: 4000 };
    expect(previewHost(a)).toBe(previewHost(b));
    expect(previewHost(a)).not.toBe(
      previewHost({ ...a, folder: "/other/folder" }),
    );
  });
  it("routes two worktrees and streams POST bodies, using the actual server port", async () => {
    const serve = (name: string) =>
      createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        res.end(
          JSON.stringify({
            name,
            path: req.url,
            method: req.method,
            host: req.headers.host,
            forwarded: req.headers["x-forwarded-host"],
            body,
          }),
        );
      });
    const first = await listen(serve("first")),
      second = await listen(serve("second")),
      p = proxy();
    const a = await p.url(target(first)),
      b = await p.url(
        target(second, { folder: "/worktrees/second", branch: "second" }),
      );
    expect(
      JSON.parse(
        (
          await get(a + "api/save?q=1", {
            method: "POST",
            body: "hello\nworld",
          })
        ).body,
      ),
    ).toEqual({
      name: "first",
      path: "/api/save?q=1",
      method: "POST",
      host: `localhost:${first}`,
      forwarded: new URL(a).host,
      body: "hello\nworld",
    });
    expect(JSON.parse((await get(b)).body).name).toBe("second");
    const anotherService = await p.url(target(second));
    expect(anotherService).not.toBe(a);
    expect(JSON.parse((await get(anotherService)).body).name).toBe("second");
    expect(JSON.parse((await get(a)).body).name).toBe("first");
  });
  it.each(["gzip", "br", "none"])(
    "tags %s HTML while preserving CSP and Unicode",
    async (encoding) => {
      const html =
        '<title>Settings &amp; account</title><script>document.title="SPA"</script><p>Žluťoučký</p>';
      const port = await listen(
        createServer((_req, res) => {
          const body =
            encoding === "gzip"
              ? gzipSync(html)
              : encoding === "br"
                ? brotliCompressSync(html)
                : Buffer.from(html);
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.setHeader("content-security-policy", "default-src 'self'");
          res.setHeader("content-length", body.length);
          res.setHeader("etag", '"original"');
          if (encoding !== "none") res.setHeader("content-encoding", encoding);
          res.end(body);
        }),
      );
      const result = await get(
        await proxy().url(target(port, { branch: "fix-<login>" })),
      );
      expect(result.body).toBe(
        html.replace("<title>", "<title>[fix-&lt;login&gt;] "),
      );
      expect(result.headers["content-security-policy"]).toBe(
        "default-src 'self'",
      );
      expect(result.headers["content-encoding"]).toBeUndefined();
      expect(result.headers["content-length"]).toBeUndefined();
      expect(result.headers.etag).toBeUndefined();
    },
  );
  it("keeps local redirects and cookies on the named host, including relative nested redirects", async () => {
    const server = createServer((req, res) => {
      res.writeHead(303, {
        location:
          req.url === "/external"
            ? "https://example.com/login"
            : req.url === "/nested/start"
              ? "next?q=1"
              : `http://127.0.0.1:${port}/login?q=1`,
        "set-cookie": [
          "session=one; Domain=localhost; HttpOnly; SameSite=Lax",
          "pref=two; Path=/; Secure",
        ],
      });
      res.end();
    });
    const port = await listen(server),
      url = await proxy().url(target(port)),
      result = await get(url);
    expect(result.status).toBe(303);
    expect(result.headers.location).toBe(url + "login?q=1");
    expect(result.headers["set-cookie"]).toEqual([
      "session=one; HttpOnly; SameSite=Lax",
      "pref=two; Path=/; Secure",
    ]);
    expect((await get(url + "nested/start")).headers.location).toBe(
      url + "nested/next?q=1",
    );
    expect((await get(url + "external")).headers.location).toBe(
      "https://example.com/login",
    );
  });
  it("proxies WebSocket subprotocols and closes both ends on shutdown", async () => {
    const server = createServer(),
      port = await listen(server),
      wsServer = new WebSocketServer({ server });
    cleanup.push(() => wsServer.close());
    wsServer.on("connection", (ws) =>
      ws.on("message", (data) => ws.send(data)),
    );
    const p = proxy(),
      url = new URL(await p.url(target(port)));
    const ws = new WebSocket(
      `ws://127.0.0.1:${url.port}/hmr?token=1`,
      "vite-hmr",
      { headers: { host: url.host } },
    );
    cleanup.push(() => ws.terminate());
    await once(ws, "open");
    expect(ws.protocol).toBe("vite-hmr");
    const message = once(ws, "message");
    ws.send("updated");
    expect(String((await message)[0])).toBe("updated");
    const closed = once(ws, "close");
    p.dispose();
    await closed;
    await expect.poll(() => wsServer.clients.size).toBe(0);
  });
  it("renders active previews, last screenshots and escaped names; rejects unknown hosts", async () => {
    const port = await listen(createServer((_req, res) => res.end("ok"))),
      p = proxy();
    const t = target(port, {
      project: "<Autago>",
      screenshot: () => Buffer.from("fixture JPEG"),
    });
    const hidden = target(port, { folder: "/closed", active: () => false });
    p.register(hidden);
    await p.url(t);
    const index = await p.indexUrl(),
      page = await get(index);
    expect(page.body).toContain("&lt;Autago&gt;");
    expect(page.body).toContain(previewHost(t));
    expect(page.body).not.toContain(previewHost(hidden));
    const image = await get(index + "_relay/screenshots/" + previewHost(t));
    expect(image.headers["content-type"]).toBe("image/jpeg");
    expect(image.body).toBe("fixture JPEG");
    expect((await get(index, { host: "attacker.invalid" })).status).toBe(404);
  });
  it("reports a busy listener only on external access and never stops the other server", async () => {
    const occupied = await listen(
        createServer((_req, res) => res.end("not Relay")),
      ),
      p = proxy(occupied),
      t = target(occupied + 1);
    expect(() => p.register(t)).not.toThrow();
    await expect(p.url(t)).rejects.toThrow(/already in use/);
    expect((await get(`http://localhost:${occupied}/`)).body).toBe("not Relay");
  });
  it("returns a useful gateway error for a stopped server", async () => {
    const server = createServer((_req, res) => res.end("ok")),
      port = await listen(server);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const result = await get(await proxy().url(target(port)));
    expect(result.status).toBe(502);
    expect(result.body).toContain(`isn't answering on port ${port}`);
  });
  it("settles a pending listen when Relay closes", async () => {
    const p = proxy(),
      opening = p.indexUrl();
    p.dispose();
    await expect(opening).rejects.toThrow(/has closed/);
    await expect(p.indexUrl()).rejects.toThrow(/has closed/);
  });
  it("rejects wake logic changing an issued route to another live service", async () => {
    const original = await listen(
        createServer((_req, res) => res.end("original")),
      ),
      other = await listen(createServer((_req, res) => res.end("other"))),
      p = proxy(),
      t = target(original);
    const url = await p.url(t);
    expect((await get(url)).body).toBe("original");
    t.wake = async () => {
      t.port = other;
    };
    expect((await get(url)).status).toBe(502);
    expect((await get(`http://localhost:${other}/`)).body).toBe("other");
  });
  it("rejects a route redirected to the proxy's own port during wake", async () => {
    const p = proxy(),
      t = target(3000);
    const url = await p.url(t);
    t.wake = async () => {
      t.port = Number(new URL(url).port);
    };
    expect((await get(url)).status).toBe(502);
  });
});
