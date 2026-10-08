import { createServer, type Server } from "node:http";
import { createServer as tcpServer, type Server as TcpServer } from "node:net";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import type { ProjectTask } from "../../shared/tasks";
import { runningServerPort } from "./running-server";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
async function listen(server: Server | TcpServer) {
  cleanup.push(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}
const task = (ports: number[]): ProjectTask => ({
  id: "fixture",
  command: "npm run dev",
  kind: "server",
  title: "Dev server",
  origin: "detached",
  started: 1,
  ports,
  pids: 1,
});
it("discovers a manually started HTTP server on its actual port", async () => {
  const port = await listen(createServer((_req, res) => res.end("ok")));
  expect(await runningServerPort([task([port])], port + 1)).toBe(port);
});
it("does not guess between multiple HTTP servers, but honours a configured live port", async () => {
  const a = await listen(createServer((_req, res) => res.end("a")));
  const b = await listen(createServer((_req, res) => res.end("b")));
  expect(await runningServerPort([task([a, b])])).toBeUndefined();
  expect(await runningServerPort([task([a, b])], b)).toBe(b);
});
it("ignores a non-HTTP listener rather than treating any open port as a web app", async () => {
  const port = await listen(
    tcpServer((socket) => socket.end("database protocol\n")),
  );
  expect(await runningServerPort([task([port])])).toBeUndefined();
});
