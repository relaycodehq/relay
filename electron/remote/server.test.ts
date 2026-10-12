import { expect, it } from "vitest";
import { handshakesPerAddress, makeRoom, maxConnections } from "./server";

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
