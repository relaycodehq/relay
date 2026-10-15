import { afterEach, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { Agent, createServer as createHttp, get } from "node:http";
import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from "node:net";
import { networkInterfaces } from "node:os";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { WebSocket, WebSocketServer } from "ws";
import {
  decodeTunnel,
  encodeTunnel,
  tunnelChunk,
  tunnelWindow,
  type TunnelFrame,
} from "../../shared/remote-tunnel";
import { Tunnel, type TunnelOptions } from "./tunnel";

vi.mock("node:zlib", async (actual) => {
  const zlib = await actual<typeof import("node:zlib")>();
  return { ...zlib, deflateRawSync: vi.fn(zlib.deflateRawSync) };
});

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function serve(
  onSocket: (socket: Socket) => void,
  host = "127.0.0.1",
): Promise<{ server: Server; port: number; sockets: Socket[] }> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on("error", () => {});
    onSocket(socket);
  });
  server.listen(0, host);
  await once(server, "listening");
  cleanup.push(() => {
    for (const s of sockets) s.destroy();
    return new Promise((r) => server.close(r));
  });
  return { server, port: (server.address() as AddressInfo).port, sockets };
}

/** The tunnel with frames handed to the test as they'd reach a phone, through the codec. */
function desktop(options: Partial<TunnelOptions> = {}) {
  const frames: TunnelFrame[] = [];
  const heard = { frame: (_: TunnelFrame) => {} };
  const tunnel = new Tunnel(
    (f) => {
      const frame = decodeTunnel(encodeTunnel(f));
      frames.push(frame);
      heard.frame(frame);
    },
    { refused: () => [], ...options },
  );
  cleanup.push(() => tunnel.close());
  const of = (stream: number) => frames.filter((f) => f.stream === stream);
  /** What a stream's data frames carried, unpacked. */
  const bytes = (stream: number) =>
    Buffer.concat(
      of(stream).flatMap((f) =>
        f.op === "data"
          ? [f.data]
          : f.op === "packed"
            ? [inflateRawSync(f.data)]
            : [],
      ),
    );
  const opened = (stream: number) =>
    vi.waitFor(() => expect(of(stream).map((f) => f.op)).toContain("opened"));
  return { tunnel, frames, of, bytes, opened, heard };
}

/**
 * The phone's side, as the Android app plays it: a loopback listener whose
 * connections become streams, written under the desktop's credit and
 * credited back as its socket takes them. Frames go both ways a turn later,
 * as over a network.
 */
async function phone(options: Partial<TunnelOptions> = {}) {
  const window = options.window ?? tunnelWindow;
  interface Local {
    socket: Socket;
    credit: number;
    consumed: number;
  }
  const streams = new Map<number, Local>();
  let next = 1;
  const tunnel = new Tunnel((f) => setImmediate(() => fromDesktop(f)), {
    refused: () => [],
    ...options,
  });
  const toDesktop = (f: TunnelFrame) =>
    setImmediate(() => tunnel.receive(decodeTunnel(encodeTunnel(f))));
  const pump = (stream: number, s: Local) => {
    let chunk: Buffer | null;
    while (s.credit > 0 && (chunk = s.socket.read() as Buffer | null)) {
      const n = Math.min(chunk.length, s.credit, tunnelChunk);
      if (n < chunk.length) s.socket.unshift(chunk.subarray(n));
      s.credit -= n;
      toDesktop({ op: "data", stream, data: chunk.subarray(0, n) });
    }
  };
  const fromDesktop = (f: TunnelFrame) => {
    const s = streams.get(f.stream);
    if (!s) return;
    if (f.op === "opened") {
      s.socket.on("readable", () => pump(f.stream, s));
      s.socket.on("end", () => toDesktop({ op: "end", stream: f.stream }));
      pump(f.stream, s);
    } else if (f.op === "data" || f.op === "packed") {
      const data = f.op === "packed" ? inflateRawSync(f.data) : f.data;
      s.socket.write(data, () => {
        s.consumed += data.length;
        if (s.consumed < window / 4) return;
        toDesktop({ op: "credit", stream: f.stream, bytes: s.consumed });
        s.consumed = 0;
      });
    } else if (f.op === "credit") {
      s.credit += f.bytes;
      pump(f.stream, s);
    } else if (f.op === "end") s.socket.end();
    else if (f.op === "close") {
      streams.delete(f.stream);
      if (f.reason) s.socket.destroy();
      else s.socket.end();
    }
  };
  const listen = async (port: number) => {
    const local = createServer({ allowHalfOpen: true }, (socket) => {
      const stream = next++;
      socket.on("error", () => {
        if (streams.delete(stream))
          toDesktop({ op: "close", stream, reason: "reset" });
      });
      streams.set(stream, { socket, credit: window, consumed: 0 });
      toDesktop({ op: "open", stream, port });
    });
    local.listen(0, "127.0.0.1");
    await once(local, "listening");
    cleanup.push(() => new Promise((r) => local.close(r)));
    return (local.address() as AddressInfo).port;
  };
  cleanup.push(() => tunnel.close());
  return { tunnel, listen };
}

const sha = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

it("carries HTTP over a kept-alive connection", async () => {
  const page = "<p>Relay on the phone</p>".repeat(4000);
  let connections = 0;
  const http = createHttp((req, res) => res.end(`${req.url} ${page}`));
  http.on("connection", () => connections++);
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  cleanup.push(() => new Promise((r) => http.close(r)));
  const { listen } = await phone();
  const local = await listen((http.address() as AddressInfo).port);
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  cleanup.push(() => agent.destroy());
  const fetch = (path: string) =>
    new Promise<string>((resolve, reject) =>
      get({ host: "127.0.0.1", port: local, path, agent }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d: string) => (body += d));
        res.on("end", () => resolve(body));
      }).on("error", reject),
    );
  expect(await fetch("/previews/x/")).toBe(`/previews/x/ ${page}`);
  expect(await fetch("/again")).toBe(`/again ${page}`);
  expect(connections).toBe(1);
});

it("carries a WebSocket upgrade, and big messages both ways under the window", async () => {
  const http = createHttp();
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (ws) => ws.on("message", (m) => ws.send(m)));
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  cleanup.push(() => {
    for (const c of wss.clients) c.terminate();
    return new Promise((r) => http.close(r));
  });
  const { listen } = await phone({ window: 64 * 1024 });
  const local = await listen((http.address() as AddressInfo).port);
  const ws = new WebSocket(`ws://127.0.0.1:${local}/`);
  cleanup.push(() => ws.terminate());
  await once(ws, "open");
  const big = randomBytes(1024 * 1024);
  const echoed = new Promise<Buffer>((resolve) =>
    ws.once("message", (m) => resolve(m as Buffer)),
  );
  ws.send(big);
  expect(sha(await echoed)).toBe(sha(big));
});

it("half-closes: the server hears the phone's end and its last bytes come back", async () => {
  const { port } = await serve((socket) => {
    const got: Buffer[] = [];
    socket.on("data", (d) => got.push(d));
    socket.on("end", () => socket.end(`heard ${Buffer.concat(got)}`));
  });
  const d = desktop();
  d.tunnel.receive({ op: "open", stream: 7, port });
  await d.opened(7);
  d.tunnel.receive({ op: "data", stream: 7, data: Buffer.from("hello") });
  d.tunnel.receive({ op: "end", stream: 7 });
  await vi.waitFor(() =>
    expect(d.of(7).map((f) => f.op)).toEqual([
      "opened",
      "data",
      "end",
      "close",
    ]),
  );
  expect(d.bytes(7).toString()).toBe("heard hello");
  expect(d.of(7).at(-1)).toMatchObject({ reason: "" });
  expect(d.tunnel.size).toBe(0);
});

it("holds a fast server to the phone's window, then sends it all as credit comes", async () => {
  const body = randomBytes(16 * 1024 * 1024);
  let served: Socket | undefined;
  const { port } = await serve((socket) => {
    served = socket;
    socket.end(body);
  });
  const d = desktop();
  d.tunnel.receive({ op: "open", stream: 1, port });
  await d.opened(1);
  await vi.waitFor(() => expect(d.bytes(1).length).toBe(tunnelWindow));
  // The rest waits in the server's own buffer, not in Relay.
  await vi.waitFor(() =>
    expect(served!.writableLength).toBeGreaterThan(8 * 1024 * 1024),
  );
  expect(d.bytes(1).length).toBe(tunnelWindow);
  expect(d.tunnel.held).toBeLessThanOrEqual(64 * 1024);

  // A phone that writes everything at once: each frame credited as it lands.
  d.heard.frame = (f) => {
    if (f.op === "data")
      setImmediate(() =>
        d.tunnel.receive({ op: "credit", stream: 1, bytes: f.data.length }),
      );
  };
  d.tunnel.receive({ op: "credit", stream: 1, bytes: tunnelWindow });
  await vi.waitFor(() => expect(d.of(1).at(-1)?.op).toBe("end"));
  expect(sha(d.bytes(1))).toBe(sha(body));
  // The server's side is done; the stream goes once the phone's is too.
  expect(d.tunnel.size).toBe(1);
  d.tunnel.receive({ op: "end", stream: 1 });
  await vi.waitFor(() => expect(d.of(1).at(-1)?.op).toBe("close"));
  expect(d.tunnel.size).toBe(0);
});

it("drops a stream the phone sends past its window", async () => {
  const { port, sockets } = await serve((socket) => socket.resume());
  const d = desktop({ window: 64 * 1024 });
  d.tunnel.receive({ op: "open", stream: 3, port });
  await d.opened(3);
  for (let sent = 0; sent <= 64 * 1024; sent += tunnelChunk)
    d.tunnel.receive({
      op: "data",
      stream: 3,
      data: new Uint8Array(tunnelChunk),
    });
  expect(d.of(3).at(-1)).toMatchObject({
    op: "close",
    reason: "The phone sent past its window.",
  });
  await vi.waitFor(() => expect(sockets[0]!.readableEnded).toBe(true));
});

it("refuses the bridge's own port without touching it, and says when nothing listens", async () => {
  const bridge = await serve(() => {});
  const d = desktop({ refused: () => [bridge.port] });
  d.tunnel.receive({ op: "open", stream: 1, port: bridge.port });
  expect(d.of(1)).toEqual([
    { op: "close", stream: 1, reason: `Port ${bridge.port} is Relay's own.` },
  ]);
  expect(bridge.sockets).toHaveLength(0);

  const gone = await serve(() => {});
  await new Promise((r) => gone.server.close(r));
  d.tunnel.receive({ op: "open", stream: 2, port: gone.port });
  await vi.waitFor(() =>
    expect(d.of(2)).toEqual([
      {
        op: "close",
        stream: 2,
        reason: `Nothing is listening on port ${gone.port}.`,
      },
    ]),
  );
});

const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((i) => i?.family === "IPv4" && !i.internal)?.address;

it.skipIf(!lanAddress)(
  "never connects past loopback, even to this computer's own network address",
  async () => {
    const lan = await serve(() => {}, lanAddress);
    const d = desktop();
    d.tunnel.receive({ op: "open", stream: 1, port: lan.port });
    await vi.waitFor(() => expect(d.of(1)[0]?.op).toBe("close"));
    expect(lan.sockets).toHaveLength(0);
  },
);

it("refuses a port that's neither a site nor typed, without touching it", async () => {
  const server = await serve(() => {});
  const d = desktop({ allowed: async (port) => port !== server.port });
  d.tunnel.receive({ op: "open", stream: 1, port: server.port });
  await vi.waitFor(() =>
    expect(d.of(1)).toEqual([
      {
        op: "close",
        stream: 1,
        reason: `Port ${server.port} isn't one of your sites. Type it into the address bar to open it.`,
      },
    ]),
  );
  expect(server.sockets).toHaveLength(0);
});

it("reaches a server that listens on ::1 alone", async (ctx) => {
  let v6: Awaited<ReturnType<typeof serve>>;
  try {
    v6 = await serve((socket) => socket.end("from ::1"), "::1");
  } catch {
    return ctx.skip();
  }
  const d = desktop();
  d.tunnel.receive({ op: "open", stream: 1, port: v6.port });
  await vi.waitFor(() => expect(d.of(1).at(-1)?.op).toBe("end"));
  expect(d.bytes(1).toString()).toBe("from ::1");
});

it("caps the streams one phone holds open", async () => {
  const { port } = await serve(() => {});
  const d = desktop({ maxStreams: 2 });
  for (const stream of [1, 2, 3])
    d.tunnel.receive({ op: "open", stream, port });
  expect(d.of(3)).toEqual([
    { op: "close", stream: 3, reason: "Too many connections at once." },
  ]);
  await d.opened(1);
  await d.opened(2);
  d.tunnel.receive({ op: "close", stream: 1, reason: "" });
  d.tunnel.receive({ op: "open", stream: 4, port });
  await d.opened(4);
});

it("ends every stream when the phone goes away, including one still connecting", async () => {
  const { port, sockets } = await serve((socket) => socket.resume());
  const d = desktop();
  d.tunnel.receive({ op: "open", stream: 1, port });
  d.tunnel.receive({ op: "open", stream: 2, port });
  await d.opened(1);
  await d.opened(2);
  d.tunnel.receive({ op: "open", stream: 3, port });
  d.tunnel.close();
  await vi.waitFor(() => {
    expect(sockets).toHaveLength(3);
    for (const s of sockets) expect(s.readableEnded || s.destroyed).toBe(true);
  });
  expect(d.of(3)).toEqual([]);
  d.tunnel.receive({ op: "open", stream: 4, port });
  expect(d.of(4)).toEqual([]);
});

it("stops deflating a stream whose chunks don't shrink, and tries again later", async () => {
  // Incompressible media, then text a kept-alive connection carries after it.
  const media = randomBytes(64 * tunnelChunk);
  const text = Buffer.from("console.log('hello');\n".repeat(64 * 1024));
  const { port } = await serve((socket) => socket.end(Buffer.concat([media, text])));
  const deflate = vi.mocked(deflateRawSync);
  deflate.mockClear();
  const d = desktop();
  d.heard.frame = (f) => {
    if (f.op === "data" || f.op === "packed")
      setImmediate(() =>
        d.tunnel.receive({
          op: "credit",
          stream: 1,
          bytes: f.op === "packed" ? inflateRawSync(f.data).length : f.data.length,
        }),
      );
  };
  d.tunnel.receive({ op: "open", stream: 1, port });
  await vi.waitFor(() => expect(d.of(1).at(-1)?.op).toBe("end"));
  expect(sha(d.bytes(1))).toBe(sha(Buffer.concat([media, text])));
  // Two tries, then one after each stretch sent as is: 3 over 64 chunks.
  const unshrunk = deflate.mock.calls.filter(
    ([data], i) =>
      deflate.mock.results[i]!.value.length >= (data as Buffer).length,
  );
  expect(unshrunk.length).toBeLessThanOrEqual(4);
  expect(d.of(1).filter((f) => f.op === "data").length).toBeGreaterThan(60);
  expect(d.of(1).filter((f) => f.op === "packed").length).toBeGreaterThan(0);
});
