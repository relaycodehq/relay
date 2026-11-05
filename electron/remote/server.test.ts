import { afterEach, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  clientHandshake,
  generateKeyPair,
  toBase64Url,
  type KeyPair,
} from "../../shared/remote-crypto";
import type { RemoteDevices } from "./devices";
import {
  handshakesPerAddress,
  makeRoom,
  maxConnections,
  RemoteServer,
} from "./server";

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function server(devices: Partial<RemoteDevices> = {}) {
  const key = generateKeyPair();
  const remote = new RemoteServer({
    devices: {
      key: async () => key,
      verify: async () => undefined,
      paired: () => true,
      seen: async () => {},
      ...devices,
    } as unknown as RemoteDevices,
    port: 0,
    name: () => "Desk",
    handle: async () => null,
  });
  await remote.listen("127.0.0.1", { anyPort: true });
  cleanup.push(() => remote.close());
  return { remote, key };
}

/** A socket through the handshake that sends `frame` sealed. */
function signIn(port: number, key: KeyPair, frame: unknown) {
  return new Promise<WebSocket>((resolve, reject) => {
    const handshake = clientHandshake(key.public);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
    cleanup.push(async () => socket.terminate());
    socket.once("open", () => socket.send(JSON.stringify(handshake.hello)));
    socket.once("error", reject);
    socket.once("close", () => reject(new Error("Turned away.")));
    socket.once("message", (data) => {
      const channel = handshake.finish(JSON.parse(data.toString()));
      socket.send(toBase64Url(channel.seal(JSON.stringify(frame))));
      resolve(socket);
    });
  });
}

const place = (from: string, state: "waiting" | "signing in" | "online") => ({
  from,
  ...(state === "online" ? { deviceId: "phone" } : {}),
  ...(state === "signing in" ? { authenticating: true } : {}),
  socket: {
    terminate() {
      this.closed = true;
    },
    closed: false,
  },
});

it("pushes out the oldest idle socket when sockets from many addresses fill the server", () => {
  const full = new Set(
    Array.from({ length: maxConnections }, (_, i) =>
      place(`192.168.1.${i + 2}`, "waiting"),
    ),
  );
  const [oldest] = full;
  expect(makeRoom(full, "192.168.1.200")).toBe(true);
  expect(oldest!.socket.closed).toBe(true);
  expect(full.has(oldest!)).toBe(false);
});

it("never pushes out a phone that is online or signing in under the pinned key", () => {
  const busy = new Set(
    Array.from({ length: maxConnections }, (_, i) =>
      place(`192.168.1.${i + 2}`, i % 2 ? "online" : "signing in"),
    ),
  );
  expect(makeRoom(busy, "192.168.1.200")).toBe(false);
  expect([...busy].some((c) => c.socket.closed)).toBe(false);
});

it("lets one address hold only a few sockets in the handshake, even with room", () => {
  const sockets = new Set([
    place("192.168.1.9", "online"),
    ...Array.from({ length: handshakesPerAddress }, () =>
      place("192.168.1.66", "waiting"),
    ),
  ]);
  const [online, oldest] = sockets;
  expect(makeRoom(sockets, "192.168.1.66")).toBe(true);
  expect(oldest!.socket.closed).toBe(true);
  expect(online!.socket.closed).toBe(false);
  expect(sockets.size).toBe(handshakesPerAddress);
});

it("cuts off a sealed frame that isn't one at once", async () => {
  const { remote, key } = await server();
  const socket = await signIn(remote.port, key, null);
  const closed = await new Promise<boolean>((resolve) => {
    socket.once("close", () => resolve(true));
    setTimeout(() => resolve(false), 2000);
  });
  expect(closed).toBe(true);
});

it("lets a phone in past refused sign-ins whose sockets never finish closing", async () => {
  let refused = 0;
  const { remote, key } = await server({
    verify: async (deviceId: string, token: string) => {
      if (token === "good") return { id: deviceId } as never;
      refused++;
      return undefined;
    },
  });
  for (let i = 0; i < maxConnections; i++) {
    const socket = await signIn(remote.port, key, {
      t: "auth",
      deviceId: "nobody",
      token: "guess",
    });
    // Never reads the server's close, so the socket lingers on its side.
    (socket as unknown as { _socket: { pause(): void } })._socket.pause();
  }
  await vi.waitFor(() => expect(refused).toBe(maxConnections));
  await signIn(remote.port, key, {
    t: "auth",
    deviceId: "phone",
    token: "good",
  });
  await vi.waitFor(() => expect(remote.online()).toEqual(new Set(["phone"])));
});
