import { WebSocketServer, type WebSocket } from "ws";
import {
  fromBase64Url,
  serverHandshake,
  toBase64Url,
  type Channel,
  type KeyPair,
} from "../../shared/remote-crypto";
import {
  remoteBridgeVersion,
  remoteMethods,
  type ClientFrame,
  type HelloFrame,
  type RemoteEvent,
  type RemoteMethod,
  type ServerFrame,
} from "../../shared/remote";
import type { RemoteDevices } from "./devices";
import { tailnetPeer } from "./tailscale";

export interface RemoteServerOptions {
  devices: RemoteDevices;
  port: number;
  name: () => string;
  handle: (
    method: RemoteMethod,
    args: unknown[],
    deviceId: string,
  ) => Promise<unknown>;
  /** A phone came online or went away. */
  onPresence?: () => void;
  tickMs?: number;
}

interface Connection {
  socket: WebSocket;
  channel?: Channel;
  deviceId?: string;
  alive: boolean;
}

/** Unauthenticated sockets get this long to finish the handshake. */
const handshakeMs = 10_000;
const maxConnections = 24;

/** The desktop end of the phone remote; see shared/remote-crypto for the channel. */
export class RemoteServer {
  private server?: WebSocketServer;
  private bound?: string;
  private connections = new Set<Connection>();
  private timer?: NodeJS.Timeout;
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
  /** The address it listens on: this computer's Tailscale address. */
  get host() {
    return this.server ? this.bound : undefined;
  }
  async listen(host: string) {
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
      // Only the tailnet reaches this address, unless someone on the same
      // network routes to it by hand; they get nothing either way.
      if (!tailnetPeer(req.socket.remoteAddress)) return socket.terminate();
      this.accept(socket, key);
    });
    this.bound = host;
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
  /** To every device online, or those `to` picks. */
  broadcast(event: RemoteEvent, to?: (deviceId: string) => boolean) {
    for (const c of this.connections)
      if (c.deviceId && this.stillPaired(c) && (!to || to(c.deviceId)))
        this.send(c, { t: "event", event });
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
  private accept(socket: WebSocket, key: KeyPair) {
    if (this.connections.size >= maxConnections) return socket.terminate();
    const c: Connection = { socket, alive: true };
    this.connections.add(c);
    const unauthenticated = setTimeout(() => {
      if (!c.deviceId) socket.terminate();
    }, handshakeMs);
    socket.on("pong", () => (c.alive = true));
    socket.on("close", () => {
      clearTimeout(unauthenticated);
      this.connections.delete(c);
      if (c.deviceId) this.options.onPresence?.();
    });
    socket.on("error", () => socket.terminate());
    socket.on("message", (data, binary) => {
      if (binary) return socket.terminate();
      const text = data.toString();
      if (!c.channel) {
        try {
          const handshake = serverHandshake(
            key,
            JSON.parse(text) as HelloFrame,
          );
          c.channel = handshake.channel;
          socket.send(JSON.stringify(handshake.hello));
        } catch {
          socket.terminate();
        }
        return;
      }
      let frame: ClientFrame;
      try {
        frame = JSON.parse(c.channel.open(fromBase64Url(text)));
      } catch {
        // Not sealed with this session's key: someone else is talking.
        return socket.terminate();
      }
      void this.receive(c, frame);
    });
  }
  private async receive(c: Connection, frame: ClientFrame) {
    const { devices } = this.options;
    if (!c.deviceId) {
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
          });
        } else throw new Error("Pair this phone first.");
        this.options.onPresence?.();
      } catch (e) {
        this.send(c, {
          t: "denied",
          reason: e instanceof Error ? e.message : "Not allowed.",
        });
        c.socket.close();
      }
      return;
    }
    if (!this.stillPaired(c)) return;
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
  private tick() {
    for (const c of this.connections) {
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      c.socket.ping();
      if (c.deviceId) this.send(c, { t: "tick" });
    }
  }
  private send(c: Connection, frame: ServerFrame) {
    if (!c.channel || c.socket.readyState !== c.socket.OPEN) return;
    c.socket.send(toBase64Url(c.channel.seal(JSON.stringify(frame))));
  }
}
