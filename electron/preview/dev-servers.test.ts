import { createServer, type Server } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DevServerState } from "../../shared/preview";
import { DevServers, IDLE_MS, listening } from "./dev-servers";

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
const serve = `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(+process.env.PORT, '127.0.0.1')"`;

describe("DevServers", () => {
  const cleanup: (() => void)[] = [];
  afterEach(() => cleanup.splice(0).forEach((f) => f()));

  it("starts the command on its port, and sleeps it once nobody looked for half an hour", async () => {
    let now = Date.now();
    const seen: DevServerState[] = [];
    const servers = new DevServers((_folder, state) => seen.push(state), () => now);
    cleanup.push(() => servers.dispose());
    const folder = await mkdtemp(join(tmpdir(), "relay-dev-"));
    const port = await freePort();
    const state = await servers.ensure(folder, serve, port, {});
    expect(state).toEqual({ state: "running", port, ours: true });
    expect(await listening(port)).toBe(true);
    expect(seen.map((s) => s.state)).toEqual(["starting", "running"]);

    servers.watch(folder, true);
    now += IDLE_MS * 2;
    servers.sleepIdle();
    expect(servers.state(folder)?.state).toBe("running");

    servers.watch(folder, false);
    now += IDLE_MS + 1;
    servers.sleepIdle();
    expect(servers.state(folder)).toEqual({ state: "asleep", port });
    await expect.poll(() => listening(port), { timeout: 5000 }).toBe(false);
  }, 30_000);

  it("leaves a server it didn't start alone", async () => {
    const port = await freePort();
    const other: Server = createServer().listen(port, "127.0.0.1");
    cleanup.push(() => other.close());
    const servers = new DevServers(() => {});
    cleanup.push(() => servers.dispose());
    const state = await servers.ensure("/nowhere", "exit 1", port, {});
    expect(state).toEqual({ state: "running", port, ours: false });
  });

  it("fails with what the command printed when it exits", async () => {
    const servers = new DevServers(() => {});
    cleanup.push(() => servers.dispose());
    const folder = await mkdtemp(join(tmpdir(), "relay-dev-"));
    const state = await servers.ensure(
      folder,
      "echo no such script >&2; exit 3",
      await freePort(),
      {},
    );
    expect(state.state).toBe("failed");
    expect(state.state === "failed" && state.output).toMatch(
      /no such script[\s\S]*Exited with code 3/,
    );
  }, 30_000);
});
