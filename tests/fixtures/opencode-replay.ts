// Plays back OpenCode's service as tests/record/opencode-proxy.ts recorded it,
// for a scenario whose `opencode service status` (replay-agent.cjs) points
// Relay here. Each request gets the answer the same request got when
// recorded, the next one if it was asked again, the last one once they run
// out; an event stream sends what it sent then. A replay never waits on time:
// an answer goes out when Relay asks for it.
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

interface Recorded {
  status: number;
  type: string;
  /** A plain answer's body, or an event stream's chunks in order. */
  body?: string;
  chunks: string[];
}

const keyOf = (method: string | undefined, path: string | undefined) =>
  `${method} ${path}`;

/** `project` stands for the recording's {{project}}, as replay-agent.cjs does. */
export async function openCodeReplayService(file: string, project: string) {
  const answers = new Map<string, Recorded[]>();
  const byN = new Map<number, Recorded>();
  const recording = (await readFile(file, "utf8"))
    .replaceAll("{{project}}", JSON.stringify(project).slice(1, -1))
    .replaceAll("{{home}}", "/home/replay");
  for (const line of recording.split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (e.kind === "request") {
      const recorded: Recorded = { status: 502, type: "", chunks: [] };
      byN.set(e.n, recorded);
      const key = keyOf(e.method, e.path);
      answers.set(key, [...(answers.get(key) ?? []), recorded]);
    } else if (e.kind === "response") {
      Object.assign(byN.get(e.n)!, { status: e.status, type: e.type });
    } else if (e.kind === "body") byN.get(e.n)!.body = e.body;
    else if (e.kind === "chunk") byN.get(e.n)!.chunks.push(e.data);
  }
  const asked = new Map<string, number>();
  /** Requests the recording had no answer for. */
  const unexpected: string[] = [];

  const answer = (req: IncomingMessage) => {
    const key = keyOf(req.method, req.url);
    const all = answers.get(key);
    if (!all) return undefined;
    const n = asked.get(key) ?? 0;
    asked.set(key, n + 1);
    return all[Math.min(n, all.length - 1)];
  };

  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const recorded = answer(req);
      if (!recorded) {
        unexpected.push(keyOf(req.method, req.url));
        res
          .writeHead(404, { "content-type": "application/json" })
          .end(JSON.stringify({ _tag: "NotFound", message: "Not recorded." }));
        return;
      }
      res.writeHead(recorded.status, { "content-type": recorded.type });
      if (
        recorded.body !== undefined ||
        !recorded.type.includes("event-stream")
      )
        return void res.end(recorded.body ?? "");
      // Held open, as the service does, until Relay hangs up.
      for (const chunk of recorded.chunks) res.write(chunk);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    unexpected,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
