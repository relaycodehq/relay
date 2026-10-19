import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../app/store";
import { PhoneRemote } from "../remote/phone-remote";
import { Computers } from "./computers";
import type { routeCommand } from "./pipe-route";

const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const seal = async (v: string) => "sealed:" + v;
const unseal = async (v: string) => v.slice(7);
const ubuntu = { kind: "wsl", distro: "Ubuntu" } as const;

async function tempDir() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-pipe-")));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const { port } = listener.address() as { port: number };
      listener.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** A Relay in WSL: no Tailscale, no LAN, so it listens on its loopback alone. */
async function relayInWsl() {
  const dir = await tempDir();
  const store = new Store(join(dir, "state"));
  await store.load();
  const port = await freePort();
  const remote = new PhoneRemote(
    store,
    seal,
    seal,
    {
      projects: async () => [],
      projectPath: () => dir,
      chats: () => [],
      chat: async () => {
        throw new Error("No threads here.");
      },
      dispatch: async () => undefined,
    },
    port,
    async () => ({ status: "missing", addresses: [] }),
    () => [],
  );
  await remote.setEnabled(true);
  cleanup.push(() => remote.close());
  // Stands in for `wsl.exe ... relay <args>`: `pipe` carries stdin and stdout
  // to its loopback, `pair --json --pipe` prints a pairing link.
  const script = join(dir, "relay.cjs");
  await writeFile(
    script,
    `const [port, url, mode] = process.argv.slice(2);
if (mode === "pipe") {
  const socket = require("node:net").connect(Number(port), "127.0.0.1");
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.on("close", () => process.exit(0));
} else console.log(JSON.stringify({ url }));
`,
  );
  const url = (await remote.pairing({ pipe: true })).url;
  const command: typeof routeCommand = (_route, args) => [
    process.execPath,
    [script, String(port), url, ...args],
  ];
  return { remote, command };
}

/** What holds WSL up, as the agent host would; `stop` is `wsl --shutdown`. */
function fakeHolders(held: string[] = []) {
  const holds = new Set(held);
  const stopped = new Set<(distro: string) => void>();
  return {
    holds,
    hold: async (distro: string) => void holds.add(distro),
    release: (distro: string) => void holds.delete(distro),
    heldDistros: async () => new Set(holds),
    releaseAll: () => holds.clear(),
    onStopped: (listener: (distro: string) => void) =>
      void stopped.add(listener),
    stop(distro: string) {
      holds.delete(distro);
      for (const listener of stopped) listener(distro);
    },
  };
}

async function laptop(
  command: typeof routeCommand,
  holders = fakeHolders(),
  store?: Store,
) {
  if (!store) {
    store = new Store(join(await tempDir(), "state"));
    await store.load();
  }
  const computers = new Computers(store, seal, unseal, {
    timeoutMs: 5000,
    holders,
    routeCommand: command,
  });
  cleanup.push(() => computers.close());
  return { computers, holders, store };
}

it("pairs with a Relay in WSL through its pipe, and after a restart wakes it only when something needs it", async () => {
  const { command } = await relayInWsl();
  const first = await laptop(command);
  const [paired] = await first.computers.pairOver(ubuntu);
  expect(paired).toMatchObject({ route: ubuntu, address: "WSL Ubuntu" });
  await vi.waitFor(() =>
    expect(first.computers.status(paired!.id)).toBe("online"),
  );
  expect([...first.holders.holds]).toEqual(["Ubuntu"]);

  // Relay restarts; the distribution it held stays held and connects at once.
  first.computers.close({ detach: true });
  expect([...first.holders.holds]).toEqual(["Ubuntu"]);
  const restarted = await laptop(command, first.holders, first.store);
  await restarted.computers.start();
  await vi.waitFor(() =>
    expect(restarted.computers.list()[0]).toMatchObject({ status: "online" }),
  );
  restarted.computers.close();
  expect(first.holders.holds.size).toBe(0);

  // Quit and opened again: nothing holds it, so nothing wakes it until a call.
  const later = await laptop(command, fakeHolders(), first.store);
  await later.computers.start();
  expect(later.computers.list()[0]).toMatchObject({
    status: "offline",
    asleep: true,
  });
  expect(later.computers.status(paired!.id)).toBe("online");
  expect(later.holders.holds.size).toBe(0);
  await later.computers.connected(paired!.id);
  expect([...later.holders.holds]).toEqual(["Ubuntu"]);
});

it("leaves a distribution WSL stopped stopped until the user wakes it", async () => {
  const { command } = await relayInWsl();
  const { computers, holders } = await laptop(command);
  const [paired] = await computers.pairOver(ubuntu);
  await computers.connected(paired!.id);

  holders.stop("Ubuntu");
  expect(computers.list()[0]).toMatchObject({
    status: "offline",
    stopped: true,
    detail: "WSL stopped it.",
  });
  expect(computers.list()[0]!.asleep).toBeUndefined();
  await expect(computers.connected(paired!.id)).rejects.toThrow(
    "Reconnect to start it again.",
  );
  expect(holders.holds.size).toBe(0);

  const [woken] = await computers.wake(paired!.id);
  expect(woken).toMatchObject({ status: "online" });
  expect(woken!.stopped).toBeUndefined();
  expect([...holders.holds]).toEqual(["Ubuntu"]);
});

// What ssh prints when it would have asked, and what the user reads instead.
it.each([
  [
    "sh: 1: exec: /home/me/.local/bin/relay: not found",
    "Relay isn't installed on box.",
  ],
  ["Host key verification failed.", "Run ssh box once in a terminal"],
  ["me@box: Permission denied (publickey,password).", "ssh-copy-id box"],
])("says what to do when ssh prints %s", async (stderr, says) => {
  const { computers } = await laptop(() => [
    process.execPath,
    [
      "-e",
      `process.stderr.write(${JSON.stringify(stderr + "\n")}); process.exit(255)`,
    ],
  ]);
  await expect(
    computers.pairOver({ kind: "ssh", host: "box" }),
  ).rejects.toThrow(says);
});

it("says so when this computer has no ssh", async () => {
  const { computers } = await laptop(() => ["relay-test-no-such-ssh", []]);
  await expect(
    computers.pairOver({ kind: "ssh", host: "box" }),
  ).rejects.toThrow("There's no ssh on this computer.");
});
