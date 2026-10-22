import { deflateRawSync, inflateRawSync } from "node:zlib";
import { WebSocketServer, type WebSocket } from "ws";
import {
  serverHandshake,
  type Channel,
  type KeyPair,
} from "../../shared/remote-crypto";
import {
  isTunnel,
  openFrame,
  sealFrame,
  sealTunnel,
  type Codec,
} from "../../shared/remote-wire";
import type { TunnelFrame } from "../../shared/remote-tunnel";
import {
  compactBridge,
  remoteBridgeVersion,
  remoteMethods,
  tunnelBridge,
  type ClientFrame,
  type HelloFrame,
  type RemoteEvent,
  type RemoteMethod,
  type ServerFrame,
} from "../../shared/remote";
import { SignInUnavailable, type RemoteDevices } from "./devices";
import { LinkSender } from "./link-sender";
import { lanPeer } from "./lan";
import { tailnetPeer } from "./tailscale";

export interface RemoteServerOptions {
  devices: RemoteDevices;
  port: number;
  name: () => string;
  /** Where devices reach this computer now, told to each as it signs in. */
  hosts?: () => string[];
  handle: (
    method: RemoteMethod,
    args: unknown[],
    deviceId: string,
  ) => Promise<unknown>;
  /** A phone came online or went away. */
  onPresence?: () => void;
  /** A signed-in device's port tunnel, made at its first tunnel frame; none refuses it. See ../tunnel. */
  tunnel?: (
    deviceId: string,
    send: (frame: TunnelFrame) => void,
  ) => TunnelEnd | undefined;
  tickMs?: number;
}

/** One connection's tunnel, as the server drives it. */
export interface TunnelEnd {
  receive(frame: TunnelFrame): void;
  /** The connection closed. */
  close(): void;
}

interface Connection {
  socket: WebSocket;
  from: string;
  channel?: Channel;
  deviceId?: string;
  alive: boolean;
  authenticating?: boolean;
  /** Binary frames and patches, once both ends speak `compactBridge`. */
  link?: LinkSender;
  /** The bridge the device said it speaks; 0 for ones from before it said. */
  bridge?: number;
  tunnel?: TunnelEnd;
  /** The phone said it's in the background (`backgroundBridge`). */
  background?: boolean;
}

/** Unauthenticated sockets get this long to finish the handshake. */
const handshakeMs = 10_000;
export const maxConnections = 24;
/** A phone has one in the handshake, two while a dead one times out. */
export const handshakesPerAddress = 4;
/** A phone in the background is ticked and pinged only every this many ticks: a minute, with the usual 15s. */
export const backgroundTickEvery = 4;

interface Place {
  from: string;
  deviceId?: string;
  authenticating?: boolean;
  socket: { terminate(): void };
}

/**
 * Makes room for a socket from `from`; false when there's none. Sockets still
 * in the handshake give way to newer ones, oldest first: a phone gets through
 * in milliseconds, so idle ones someone else holds open can't lock it out.
 * Signed-in sockets, and those signing in under the pinned key, stay.
 */
export function makeRoom<T extends Place>(connections: Set<T>, from: string) {
  const waiting = [...connections].filter(
    (c) => !c.deviceId && !c.authenticating,
  );
  const fromHere = waiting.filter((c) => c.from === from);
  const evict =
    fromHere.length >= handshakesPerAddress
      ? fromHere[0]
      : connections.size >= maxConnections
        ? waiting[0]
        : undefined;
  if (evict) {
    connections.delete(evict);
    evict.socket.terminate();
  }
  return connections.size < maxConnections;
}

export const nodeCodec: Codec = {
  deflate: (bytes) => deflateRawSync(bytes, { level: 6 }),
  // Inflated past this is no frame we'd send.
  inflate: (bytes) =>
    inflateRawSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }),
  deflateUpTo: Infinity,
};

/** The desktop end of the phone remote; see shared/remote-crypto for the channel. */
export class RemoteServer {
  private server?: WebSocketServer;
  private bound?: string;
  private lan = false;
  private connections = new Set<Connection>();
  private timer?: NodeJS.Timeout;
  private ticks = 0;
  constructor(private options: RemoteServerOptions) {}
  get port() {
    const address = this.server?.address();
    return typeof address === "object" && address
      ? address.port
      : this.options.port;
  }
  get listening() {
    return !!this.server;
  }
  /** Devices with an authenticated connection. */
  online() {
    return new Set(
      [...this.connections].flatMap((c) => (c.deviceId ? [c.deviceId] : [])),
    );
  }
  /** The address it listens on: Tailscale's, or every one with the local network allowed. */
  get host() {
    return this.server ? this.bound : undefined;
  }
  /** With `lan`, devices on the local network may connect as well as the tailnet's. */
  async listen(host: string, lan = false) {
    if (this.server) return;
    const key = await this.options.devices.key();
    const server = new WebSocketServer({
      port: this.options.port,
      host,
      // Room for three photos, each up to 1.1 MB as a data URL, once sealed.
      maxPayload: 8 * 1024 * 1024,
      perMessageDeflate: false,
    });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    }).catch((e: NodeJS.ErrnoException) => {
      server.close();
      throw new Error(
        e.code === "EADDRINUSE"
          ? `Port ${this.options.port} is taken by another app.`
          : `Phone access couldn't start: ${e.message}`,
      );
    });
    server.on("error", (e) => console.warn("Phone remote:", e));
    server.on("connection", (socket, req) => {
      // Only the tailnet reaches its address, unless someone on the same
      // network routes to it by hand; with the local network allowed, its
      // private addresses come in too. Without the pinned key and a token
      // they get nothing either way.
      const from = req.socket.remoteAddress;
      if (!tailnetPeer(from) && !(this.lan && lanPeer(from)))
        return socket.terminate();
      this.accept(socket, key, from!);
    });
    this.bound = host;
    this.lan = lan;
    this.server = server;
    this.timer = setInterval(() => this.tick(), this.options.tickMs ?? 15_000);
  }
  async close() {
    clearInterval(this.timer);
    const server = this.server;
    this.server = undefined;
    for (const c of this.connections) c.socket.terminate();
    this.connections.clear();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  /** To every device online, or those `to` picks by id and the bridge they speak. */
  broadcast(
    event: RemoteEvent,
    to?: (deviceId: string, bridge: number) => boolean,
  ) {
    for (const c of this.connections)
      if (
        c.deviceId &&
        this.stillPaired(c) &&
        (!to || to(c.deviceId, c.bridge ?? 0))
      )
        if (c.link) c.link.event(event);
        else this.send(c, { t: "event", event });
  }
  /**
   * Ends the session of a device removed since it signed in, as the removal
   * can land while its sign-in is still under way and miss `disconnect`.
   */
  private stillPaired(c: Connection) {
    if (c.deviceId && this.options.devices.paired(c.deviceId)) return true;
    this.send(c, { t: "denied", reason: "This phone was removed in Relay." });
    c.socket.close();
    return false;
  }
  /** Ends a revoked device's sessions right away. */
  disconnect(deviceId: string, reason = "This phone was removed in Relay.") {
    for (const c of this.connections)
      if (c.deviceId === deviceId) {
        this.send(c, { t: "denied", reason });
        c.socket.close();
      }
  }
  private accept(socket: WebSocket, key: KeyPair, from: string) {
    if (!makeRoom(this.connections, from)) return socket.terminate();
    const c: Connection = { socket, from, alive: true };
    this.connections.add(c);
    const unauthenticated = setTimeout(() => {
      if (!c.deviceId) socket.terminate();
    }, handshakeMs);
    socket.on("pong", () => (c.alive = true));
    socket.on("close", () => {
      clearTimeout(unauthenticated);
      c.tunnel?.close();
      c.link?.close();
      this.connections.delete(c);
      if (c.deviceId) this.options.onPresence?.();
    });
    socket.on("error", () => socket.terminate());
    socket.on("message", (data, binary) => {
      if (binary && !c.link) return socket.terminate();
      if (!c.channel) {
        try {
          const handshake = serverHandshake(
            key,
            JSON.parse(data.toString()) as HelloFrame,
          );
          c.channel = handshake.channel;
          socket.send(JSON.stringify(handshake.hello));
        } catch {
          socket.terminate();
        }
        return;
      }
      let frame: unknown;
      try {
        frame = openFrame(
          c.channel,
          binary ? (data as Buffer) : data.toString(),
          nodeCodec,
        );
      } catch {
        // Not sealed with this session's key: someone else is talking.
        return socket.terminate();
      }
      if (isTunnel(frame)) return this.tunnel(c, frame.frame);
      void this.receive(c, frame as ClientFrame);
    });
  }
  private async receive(c: Connection, frame: ClientFrame) {
    const { devices } = this.options;
    if (!c.deviceId) {
      // One sign-in per socket, including while persistence is pending.
      if (c.authenticating) return c.socket.terminate();
      c.authenticating = true;
      try {
        if (frame.t === "pair") {
          const { device, token } = await devices.pair(
            String(frame.code),
            String(frame.device ?? ""),
            frame.kind === "computer" ? "computer" : undefined,
          );
          c.deviceId = device.id;
          this.send(c, {
            t: "paired",
            deviceId: device.id,
            token,
            name: this.options.name(),
            bridge: remoteBridgeVersion,
            hosts: this.options.hosts?.() ?? [],
          });
        } else if (frame.t === "auth") {
          const device = await devices.verify(
            String(frame.deviceId),
            String(frame.token),
          );
          if (!device)
            throw new Error("This phone isn't paired with Relay anymore.");
          c.deviceId = device.id;
          this.send(c, {
            t: "ready",
            name: this.options.name(),
            bridge: remoteBridgeVersion,
            hosts: this.options.hosts?.() ?? [],
          });
        } else throw new Error("Pair this phone first.");
        c.bridge = Number(frame.bridge) || 0;
        // `paired` and `ready` went as text, which every client reads.
        if (c.bridge >= compactBridge)
          c.link = new LinkSender((f) => this.send(c, f));
        this.options.onPresence?.();
      } catch (e) {
        // Only persistence after a valid token is retryable. Invalid tokens
        // never reach it, and cryptographic failures terminate in accept().
        if (e instanceof SignInUnavailable) {
          console.warn("Phone remote: couldn't check a phone's sign-in:", e.cause);
          return c.socket.close();
        }
        this.send(c, {
          t: "denied",
          reason: frame.t === "auth"
            ? "This phone isn't paired with Relay anymore."
            : e instanceof Error ? e.message : "Not allowed.",
        });
        c.socket.close();
      }
      return;
    }
    if (!this.stillPaired(c)) return;
    if (frame.t === "got") return c.link?.got(Number(frame.s));
    if (frame.t === "background") {
      c.background = frame.on === true;
      c.link?.setBackground(c.background);
      // Back, a tick at once tells the phone the link survived its time away.
      if (!c.background) this.send(c, { t: "tick", hosts: this.options.hosts?.() });
      return;
    }
    if (frame.t !== "call" || !Number.isSafeInteger(frame.id)) return;
    const { id, method, args } = frame;
    try {
      if (!(remoteMethods as readonly string[]).includes(method))
        throw new Error("Phones can't do that.");
      if (!Array.isArray(args) || args.length > 4)
        throw new Error("Invalid request.");
      const value = await this.options.handle(method, args, c.deviceId);
      this.send(c, { t: "result", id, ok: true, value: value ?? null });
    } catch (e) {
      this.send(c, {
        t: "result",
        id,
        ok: false,
        error: e instanceof Error ? e.message : "Unexpected error",
      });
    }
  }
  /** Only from a signed-in device that said it speaks the tunnel; anyone else isn't a phone of ours. */
  private tunnel(c: Connection, frame: TunnelFrame) {
    if (!c.deviceId || (c.bridge ?? 0) < tunnelBridge)
      return c.socket.terminate();
    if (!this.stillPaired(c)) return;
    const send = (f: TunnelFrame) => {
      if (c.channel && c.socket.readyState === c.socket.OPEN)
        c.socket.send(sealTunnel(c.channel, f));
    };
    c.tunnel ??= this.options.tunnel?.(c.deviceId, send);
    if (c.tunnel) c.tunnel.receive(frame);
    else if (frame.op === "open")
      send({
        op: "close",
        stream: frame.stream,
        reason: "Only a paired phone can open ports here.",
      });
  }
  private tick() {
    const slow = ++this.ticks % backgroundTickEvery !== 0;
    for (const c of this.connections) {
      if (c.background && slow) continue;
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      c.socket.ping();
      if (c.deviceId) {
        this.send(c, { t: "tick", hosts: this.options.hosts?.() });
        void this.options.devices.seen(c.deviceId);
      }
    }
  }
  /** The bytes it took on the wire. */
  private send(c: Connection, frame: ServerFrame) {
    if (!c.channel || c.socket.readyState !== c.socket.OPEN) return 0;
    const data = sealFrame(c.channel, frame, !!c.link, nodeCodec);
    c.socket.send(data);
    return data.length;
  }
}
