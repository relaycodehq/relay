import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadRelayMcp, serveRelayTools } from ".";

const closing: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
  vi.restoreAllMocks();
});

const configured = async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-mcp-"));
  return { dir, config: await loadRelayMcp(dir) };
};

it("keeps its port while nobody or Relay's own tools hold it", async () => {
  const { dir, config } = await configured();
  expect(await loadRelayMcp(dir)).toEqual(config);
  const serving = serveRelayTools(config.port, {
    verify: () => undefined,
    call: async () => ({ content: [] }),
  });
  closing.push(serving.close);
  await serving.ready;
  expect(await loadRelayMcp(dir)).toEqual(config);
});

it("moves to a new port when another app took the saved one", async () => {
  const { dir, config } = await configured();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const stranger = createServer((_, res) => res.end("hello"));
  await new Promise<void>((r) => stranger.listen(config.port, "127.0.0.1", r));
  closing.push(() => new Promise((r) => stranger.close(r)));
  const moved = await loadRelayMcp(dir);
  expect(moved.port).not.toBe(config.port);
  expect(moved.secret).toBe(config.secret);
  expect(await loadRelayMcp(dir)).toEqual(moved);
});
