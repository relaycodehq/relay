import { connect, createServer, type Server } from "node:net";
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DevServerState } from "../../shared/preview";
import { AgentHosts } from "../agent-host/client";
import { hostAgents } from "../agents/hosted-sessions";
import { projectTasks } from "../terminal/tasks";
import { DevServers, IDLE_MS, listening } from "./dev-servers";
import { runningServerPorts } from "./running-server";

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
    await servers.sleepIdle();
    expect(servers.state(folder)?.state).toBe("running");

    servers.watch(folder, false);
    now += IDLE_MS + 1;
    await servers.sleepIdle();
    expect(servers.state(folder)).toEqual({ state: "asleep", port });
    await expect.poll(() => listening(port)).toBe(false);
  });

  it("keeps a server something is connected to, and sleeps it half an hour after the last", async () => {
    let now = Date.now();
    let open = true;
    const servers = new DevServers(
      () => {},
      () => now,
      async (ports) => new Set(open ? ports : []),
    );
    cleanup.push(() => servers.dispose());
    const folder = await mkdtemp(join(tmpdir(), "relay-dev-used-"));
    const port = await freePort();
    await servers.ensure(folder, serve, port, {});

    now += IDLE_MS * 2;
    await servers.sleepIdle();
    expect(servers.state(folder)?.state).toBe("running");

    open = false;
    now += IDLE_MS / 2;
    await servers.sleepIdle();
    expect(servers.state(folder)?.state).toBe("running");
    now += IDLE_MS / 2 + 1;
    await servers.sleepIdle();
    expect(servers.state(folder)).toEqual({ state: "asleep", port });
  });

  it("keeps every server when it can't tell what is connected", async () => {
    let now = Date.now();
    const servers = new DevServers(
      () => {},
      () => now,
      async () => {
        throw new Error("lsof is missing");
      },
    );
    cleanup.push(() => servers.dispose());
    const folder = await mkdtemp(join(tmpdir(), "relay-dev-unknown-"));
    const port = await freePort();
    await servers.ensure(folder, serve, port, {});
    now += IDLE_MS * 2;
    await servers.sleepIdle();
    expect(servers.state(folder)?.state).toBe("running");
  });

  it("falls back to previews alone when it can't look at connections at all, or keeps failing to", async () => {
    let now = Date.now();
    let error: Error = Object.assign(new Error("spawn lsof ENOENT"), {
      code: "ENOENT",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cleanup.push(() => warn.mockRestore());
    const servers = new DevServers(
      () => {},
      () => now,
      async () => {
        throw error;
      },
    );
    cleanup.push(() => servers.dispose());
    const missing = await mkdtemp(join(tmpdir(), "relay-dev-no-lsof-"));
    const missingPort = await freePort();
    await servers.ensure(missing, serve, missingPort, {});
    now += IDLE_MS + 1;
    await servers.sleepIdle();
    expect(servers.state(missing)?.state).toBe("asleep");

    error = new Error("lsof timed out");
    const slow = await mkdtemp(join(tmpdir(), "relay-dev-slow-lsof-"));
    const slowPort = await freePort();
    await servers.ensure(slow, serve, slowPort, {});
    now += IDLE_MS + 1;
    await servers.sleepIdle();
    await servers.sleepIdle();
    expect(servers.state(slow)?.state).toBe("running");
    await servers.sleepIdle();
    expect(servers.state(slow)?.state).toBe("asleep");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.skipIf(process.platform !== "darwin")(
    "sees a browser's open connection to a server it started",
    async () => {
      let now = Date.now();
      const servers = new DevServers(
        () => {},
        () => now,
      );
      cleanup.push(() => servers.dispose());
      const folder = await mkdtemp(join(tmpdir(), "relay-dev-socket-"));
      const port = await freePort();
      await servers.ensure(folder, serve, port, {});
      const tab = connect({ host: "127.0.0.1", port });
      await new Promise((r) => tab.once("connect", r));
      cleanup.push(() => tab.destroy());
      now += IDLE_MS * 2;
      await servers.sleepIdle();
      expect(servers.state(folder)?.state).toBe("running");
    },
  );

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
  });

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
    await servers.sleepIdle();
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
  });

  it("restarts a managed worktree server through its owner with its port and environment", async () => {
    let now = Date.now();
    const servers = new DevServers(
      () => {},
      () => now,
      async () => new Set(),
    );
    cleanup.push(() => servers.dispose());
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-dev-restart-")),
    );
    const folder = await realpath(await mkdtemp(join(root, "worktree-")));
    const port = await freePort();
    const command = `node -e "require('fs').appendFileSync('launches', process.env.RELAY_PORT_OFFSET + ':' + process.env.PORT + '\\n'); require('http').createServer((q,s)=>s.end('ok')).listen(+process.env.PORT, '127.0.0.1')"`;
    const env = { RELAY_PORT_OFFSET: "40", RELAY_WORKTREE: folder };
    await servers.ensure(folder, command, port, env);
    const worktrees = [{ path: folder, chatId: "thread" }];
    const [task] = await projectTasks.list(root, worktrees, { fresh: true });
    expect(task).toMatchObject({ origin: "relay", worktree: "thread", folder });
    const restarted = projectTasks.restart(root, task!.id, worktrees);
    await expect.poll(() => servers.state(folder)?.state).toBe("starting");
    const waking = servers.ensure(folder, command, port, env);
    await restarted;
    expect(await waking).toEqual({ state: "running", port, ours: true });
    expect(await readFile(join(folder, "launches"), "utf8")).toBe(
      `40:${port}\n40:${port}\n`,
    );
    const [next] = await projectTasks.list(root, worktrees, { fresh: true });
    expect(next!.id).not.toBe(task!.id);
    expect(next).toMatchObject({
      origin: "relay",
      worktree: "thread",
      ports: [port],
    });
    now += IDLE_MS + 1;
    await servers.sleepIdle();
    expect(servers.state(folder)?.state).toBe("asleep");
    await expect.poll(() => listening(port)).toBe(false);
  });

  it("keeps ownership when the validated stop fails, and cancels an in-flight restart on disposal", async () => {
    const track = vi.spyOn(projectTasks, "trackServer");
    cleanup.push(() => track.mockRestore());
    const servers = new DevServers(() => {});
    cleanup.push(() => servers.dispose());
    const folder = await realpath(
      await mkdtemp(join(tmpdir(), "relay-dev-stop-fail-")),
    );
    const port = await freePort();
    await servers.ensure(
      folder,
      `echo started >> launches; ${serve}`,
      port,
      {},
    );
    const restart = track.mock.calls.find((args) => args[2] === folder)![3];
    await expect(
      restart(async () => {
        throw new Error("Could not validate stop");
      }),
    ).rejects.toThrow("Could not validate stop");
    expect(servers.state(folder)?.state).toBe("failed");
    expect(await listening(port)).toBe(true);
    expect(await readFile(join(folder, "launches"), "utf8")).toBe("started\n");
    // A failed stop must retain the original child so shutdown can still stop it.
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pending = restart(() => gate);
    expect(servers.state(folder)?.state).toBe("starting");
    servers.dispose();
    finish();
    await expect(pending).rejects.toThrow("stopped before it could restart");
    await expect.poll(() => listening(port)).toBe(false);
    expect(servers.state(folder)).toBeUndefined();
    expect(await readFile(join(folder, "launches"), "utf8")).toBe("started\n");
  });

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
  });

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
  });

  it("rejects an invalid port without leaving a starting server", async () => {
    const servers = new DevServers(() => {});
    cleanup.push(() => servers.dispose());
    await expect(servers.ensure("/repo", "serve", 65540, {})).rejects.toThrow(
      "between 1 and 65535",
    );
    expect(servers.state("/repo")).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "lets the preview find a server it started by its folder",
    async () => {
      const servers = new DevServers(() => {});
      cleanup.push(() => servers.dispose());
      const folder = await realpath(
        await mkdtemp(join(tmpdir(), "relay-dev-found-")),
      );
      const port = await freePort();
      await servers.ensure(folder, serve, port, {});
      const tasks = await projectTasks.list(folder, [], {
        fresh: true,
        includeNewServers: true,
      });
      expect(
        await runningServerPorts(tasks.filter((t) => t.folder === folder)),
      ).toEqual([port]);
    },
  );
});

describe.skipIf(process.platform === "win32")(
  "DevServers in the agent host",
  () => {
    let root: string, script: string;
    const opened: AgentHosts[] = [];
    const cleanup: (() => void)[] = [];
    beforeAll(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), "relay-dev-host-")));
      script = join(root, "agent-host.mjs");
      await build({
        entryPoints: ["electron/agent-host/host.ts"],
        bundle: true,
        platform: "node",
        format: "esm",
        outfile: script,
        logLevel: "error",
        banner: {
          js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
        },
      });
    });
    afterEach(async () => {
      cleanup.splice(0).forEach((f) => f());
      hostAgents(undefined);
      for (const hosts of opened.splice(0)) hosts.detach();
      // A host stopping stops the servers it runs.
      const dir = join(root, "hosts");
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        const pid = Number(/^host-(\d+)\.json$/.exec(name)?.[1]);
        if (!pid) continue;
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
        await expect.poll(() => alive(pid)).toBe(false);
      }
      await rm(dir, { recursive: true, force: true });
    });
    afterAll(() => rm(root, { recursive: true, force: true }));

    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    /** A Relay starting: its own hosts, and dev servers that run in them. */
    const relay = () => {
      const hosts = new AgentHosts(join(root, "hosts"), script);
      opened.push(hosts);
      hostAgents(hosts);
      const seen: DevServerState[] = [];
      const servers = new DevServers((_folder, state) => seen.push(state));
      cleanup.push(() => servers.dispose());
      return { hosts, servers, seen };
    };
    /** Relay restarting: the hosts and the servers they run carry on. */
    const restart = ({ hosts, servers }: ReturnType<typeof relay>) => {
      servers.detach();
      hosts.detach();
      hostAgents(undefined);
    };
    const folderWith = async (name: string) =>
      realpath(await mkdtemp(join(root, name)));
    const launches = (folder: string) =>
      readFile(join(folder, "launches"), "utf8").then(
        (text) => text.trim().split("\n").length,
        () => 0,
      );

    it("keeps a server running through a restart, and the next Relay takes it back instead of starting another", async () => {
      const folder = await folderWith("kept-");
      const port = await freePort();
      const command = `echo "$RELAY_PORT_OFFSET:$PORT" >> launches; ${serve}`;
      const first = relay();
      expect(
        await first.servers.ensure(folder, command, port, {
          RELAY_PORT_OFFSET: "25",
        }),
      ).toEqual({
        state: "running",
        port,
        ours: true,
      });
      restart(first);
      // Run in Relay, the restart would have stopped it.
      await new Promise((r) => setTimeout(r, 300));
      expect(await listening(port)).toBe(true);

      const next = relay();
      void next.servers.reattach();
      // A preview opening while the hosts still answer waits for them.
      expect(await next.servers.ensure(folder, command, port, {})).toEqual({
        state: "running",
        port,
        ours: true,
      });
      expect(await launches(folder)).toBe(1);
      // The preview finds it by its folder, though Relay didn't start it this time.
      await expect
        .poll(async () =>
          runningServerPorts(
            (
              await projectTasks.list(folder, [], {
                fresh: true,
                includeNewServers: true,
              })
            ).filter((t) => t.folder === folder),
          ),
        )
        .toEqual([port]);

      // Restart directly from Running Tasks, without a new preview supplying env.
      const [task] = await projectTasks.list(folder, [], { fresh: true });
      await projectTasks.restart(folder, task!.id);
      expect(next.servers.state(folder)).toEqual({
        state: "running",
        port,
        ours: true,
      });
      expect(await launches(folder)).toBe(2);
      expect(await readFile(join(folder, "launches"), "utf8")).toBe(
        `25:${port}\n25:${port}\n`,
      );

      // Quitting for real stops it.
      next.servers.dispose();
      await expect.poll(() => listening(port)).toBe(false);
    });

    it("starts a server again that exited while Relay was away", async () => {
      const folder = await folderWith("died-");
      const port = await freePort();
      const command = `echo started >> launches; echo $$ > shell.pid; ${serve}`;
      const first = relay();
      await first.servers.ensure(folder, command, port, {});
      restart(first);
      const shell = Number(await readFile(join(folder, "shell.pid"), "utf8"));
      process.kill(-shell, "SIGKILL");
      await expect.poll(() => listening(port)).toBe(false);
      // Wait for the host to see it go, as a Relay restarting later would.
      await expect
        .poll(async () => {
          const observer = new AgentHosts(join(root, "hosts"), script);
          const found = await observer.discover();
          observer.detach();
          return found.map((f) => !!f.info.ended);
        })
        .toEqual([true]);

      const next = relay();
      await next.servers.reattach();
      expect(next.servers.state(folder)).toBeUndefined();
      expect(next.seen).toEqual([]);
      expect(await next.servers.ensure(folder, command, port, {})).toEqual({
        state: "running",
        port,
        ours: true,
      });
      expect(await launches(folder)).toBe(2);
    });

    it("fails with what the command printed, once", async () => {
      const { servers } = relay();
      const folder = await folderWith("failed-");
      const state = await servers.ensure(
        folder,
        "echo no such script >&2; exit 3",
        await freePort(),
        {},
      );
      expect(state.state).toBe("failed");
      const output = state.state === "failed" ? state.output : "";
      expect(output).toMatch(/no such script[\s\S]*exited \(3\)/);
      expect(output.match(/no such script/g)).toHaveLength(1);
    });
  },
);
