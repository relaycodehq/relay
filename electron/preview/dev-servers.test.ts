import { createServer, type Server } from "node:net";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalUrls } from "./local-urls";
import { ServerLinks } from "./server-links";
import type { ProjectChat } from "../../shared/projects";
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
    const servers = new DevServers(
      (_folder, state) => seen.push(state),
      () => now,
    );
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

  it("shares concurrent wakeups after a managed server sleeps", async () => {
    let now = Date.now();
    const servers = new DevServers(
      () => {},
      () => now,
    );
    cleanup.push(() => servers.dispose());
    const folder = await realpath(
      await mkdtemp(join(tmpdir(), "relay-dev-race-")),
    );
    const port = await freePort();
    const command = `echo started >> launches; ${serve}`;
    await servers.ensure(folder, command, port, {});
    now += IDLE_MS + 1;
    servers.sleepIdle();
    await expect.poll(() => listening(port)).toBe(false);
    const states = await Promise.all([
      servers.ensure(folder, command, port, {}),
      servers.ensure(folder, command, port, {}),
    ]);
    expect(states.every((s) => s.state === "running")).toBe(true);
    expect(
      (await readFile(join(folder, "launches"), "utf8")).trim().split("\n"),
    ).toEqual(["started", "started"]);
    servers.stop(folder);
    await expect.poll(() => listening(port)).toBe(false);
  }, 30_000);

  it("cancels startup before the initial port probe finishes", async () => {
    const seen: DevServerState[] = [];
    const servers = new DevServers((_folder, state) => seen.push(state));
    cleanup.push(() => servers.dispose());
    const folder = await mkdtemp(join(tmpdir(), "relay-dev-cancel-"));
    const port = await freePort();
    const pending = servers.ensure(folder, serve, port, {});
    servers.stop(folder);
    expect(await pending).toEqual({ state: "asleep", port });
    expect(servers.state(folder)).toBeUndefined();
    expect(seen.map((s) => s.state)).toEqual(["starting"]);
    expect(await listening(port)).toBe(false);
  });

  it("settles startup waiters and ignores old child exits when the port changes", async () => {
    const seen: DevServerState[] = [];
    const servers = new DevServers((_folder, state) => seen.push(state));
    cleanup.push(() => servers.dispose());
    const folder = await mkdtemp(join(tmpdir(), "relay-dev-switch-"));
    const oldPort = await freePort();
    const nextPort = await freePort();
    const pending = servers.ensure(
      folder,
      `echo spawned > marker; node -e "setInterval(()=>{},1000)"`,
      oldPort,
      {},
    );
    await expect
      .poll(() => readFile(join(folder, "marker"), "utf8").catch(() => ""))
      .toBe("spawned\n");
    await servers.ensure(folder, serve, nextPort, {});
    expect(await pending).toEqual({ state: "asleep", port: oldPort });
    expect(
      seen.filter((s) => "port" in s && s.port === oldPort).map((s) => s.state),
    ).toEqual(["starting"]);
    expect(servers.state(folder)).toEqual({
      state: "running",
      port: nextPort,
      ours: true,
    });
  }, 30_000);

  it("starts the saved command after an externally owned listener exits", async () => {
    const servers = new DevServers(() => {});
    cleanup.push(() => servers.dispose());
    const folder = await mkdtemp(join(tmpdir(), "relay-dev-external-"));
    const port = await freePort();
    const external = createServer().listen(port, "127.0.0.1");
    expect(await servers.ensure(folder, serve, port, {})).toEqual({
      state: "running",
      port,
      ours: false,
    });
    await new Promise<void>((r) => external.close(() => r()));
    expect(await servers.ensure(folder, serve, port, {})).toEqual({
      state: "running",
      port,
      ours: true,
    });
  }, 30_000);

  it("rejects an invalid port without leaving a starting server", async () => {
    const servers = new DevServers(() => {});
    cleanup.push(() => servers.dispose());
    await expect(servers.ensure("/repo", "serve", 65540, {})).rejects.toThrow(
      "between 1 and 65535",
    );
    expect(servers.state("/repo")).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "discovers Relay-managed HTTP servers for answer links and agent context",
    async () => {
      const servers = new DevServers(() => {});
      const urls = new LocalUrls(0);
      cleanup.push(() => {
        urls.dispose();
        servers.dispose();
      });
      const folder = await realpath(
        await mkdtemp(join(tmpdir(), "relay-dev-links-")),
      );
      const port = await freePort();
      await servers.ensure(folder, serve, port, {});
      const links = new ServerLinks(urls, async () => ({
        project: "fixture",
        root: folder,
        worktrees: [],
        allowed: [folder],
      }));
      const chat = { id: "thread" } as ProjectChat;
      const answer = await links.answer(
        chat,
        `[Page](http://localhost:${port}/path?q=1#details)`,
      );
      expect(answer).toMatch(/fixture\.relay\.localhost:/);
      expect(answer).toContain("/path?q=1#details");
      expect(await links.note(chat)).toContain(`localhost:${port} → http://`);
    },
    30_000,
  );
});
