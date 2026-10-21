// Stands between Relay and the real OpenCode service while recording, and
// writes down what crossed it for tests/fixtures/opencode-replay.ts: every
// request, every response, and an event stream's events as they came. The
// recorder's `opencode service status` points Relay here instead of at the
// service; it tells this proxy where the service really is. Headers stay out,
// the service password with them.
import { appendFileSync } from "node:fs";
import {
  createServer,
  request,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

/** Where `opencode service status` told the recorder the real service is: POST its URL here. */
export const TARGET_PATH = "/__relay_record_target";

const body = (req: IncomingMessage) =>
  new Promise<string>((done, fail) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });

export async function openCodeRecordingProxy(out: string) {
  const file = join(out, "http.jsonl");
  const write = (entry: object) =>
    appendFileSync(file, JSON.stringify({ at: Date.now(), ...entry }) + "\n");
  let target: URL | undefined;
  let next = 0;

  const forward = async (req: IncomingMessage, res: ServerResponse) => {
    const n = next++;
    const text = await body(req);
    write({
      kind: "request",
      n,
      method: req.method,
      path: req.url,
      body: text,
    });
    if (!target) {
      res.writeHead(502).end("The recorder hasn't heard where OpenCode runs.");
      return;
    }
    // Plain bodies, so the recording reads as text.
    const { "accept-encoding": _, ...asked } = req.headers;
    const headers = { ...asked, host: target.host };
    const upstream = request(
      new URL(req.url ?? "/", target),
      { method: req.method, headers },
      (answer) => {
        const type = String(answer.headers["content-type"] ?? "");
        const stream = type.includes("text/event-stream");
        write({ kind: "response", n, status: answer.statusCode, type, stream });
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        if (stream) res.flushHeaders();
        const chunks: Buffer[] = [];
        answer.on("data", (chunk: Buffer) => {
          if (stream) write({ kind: "chunk", n, data: chunk.toString("utf8") });
          else chunks.push(chunk);
          res.write(chunk);
        });
        answer.on("end", () => {
          if (!stream)
            write({
              kind: "body",
              n,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          write({ kind: "end", n });
          res.end();
        });
      },
    );
    upstream.on("error", (error) => {
      write({ kind: "error", n, message: error.message });
      res.destroy(error);
    });
    // Relay hanging up an event stream ends it upstream too.
    res.on("close", () => upstream.destroy());
    upstream.end(text);
  };

  const server = createServer((req, res) => {
    if (req.url === TARGET_PATH && req.method === "POST")
      return void body(req).then((url) => {
        target = new URL(url.trim());
        res.end();
      });
    void forward(req, res).catch((error) => res.destroy(error));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
