/**
 * A connection to a desktop's bridge, as another computer handing a thread
 * over makes it. The desktop's tests drive this exact client against the real bridge.
 */
import type { ChatMessage } from "./projects";
import { clientHandshake, fromBase64Url, type Channel } from "./remote-crypto";
import { applyChatsPatch, applyMessagePatch } from "./remote-delta";
import { jsCodec, openFrame, sealFrame, type Codec } from "./remote-wire";
import {
  defaultRoutes,
  learnHosts,
  orderHosts,
  routeKind,
  type RouteKind,
} from "./remote-routes";
import type {
  ClientFrame,
  DesktopCall,
  DeviceKind,
  HelloFrame,
  PairingLink,
  RemoteApi,
  RemoteCredentials,
  RemoteEvent,
  RemoteMethod,
  WireEvent,
  PhoneDesktopMethod,
  RemoteChatSummary,
  ServerFrame,
} from "./remote";
import {
  compactBridge,
  recipientBridge,
  remoteBridgeVersion,
  slowPhoneMethods,
  slowRemoteMethods,
  validHost,
} from "./remote";

export type RemoteStatus = "connecting" | "online" | "offline" | "denied";

type Start =
  { link: PairingLink; device: string; kind?: DeviceKind } | RemoteCredentials;

export interface RemoteClientOptions {
  start: Start;
  WebSocket?: typeof WebSocket;
  onStatus?: (status: RemoteStatus, detail?: string) => void;
  onEvent?: (event: RemoteEvent) => void;
  /** First contact traded the pairing code for these; keep them to reconnect. */
  onPaired?: (credentials: RemoteCredentials) => void;
  /** The desktop named new addresses, or the route order changed; keep these instead. */
  onCredentials?: (credentials: RemoteCredentials) => void;
  /** Per host while connecting, and per call. */
  timeoutMs?: number;
  /** How long one route gets before the next is tried beside it. */
  staggerMs?: number;
  /** How often a link on a later route looks for an earlier one. */
  betterRouteMs?: number;
  /** Per call for `slowPhoneMethods` and `slowRemoteMethods`. */
  slowTimeoutMs?: number;
  /** Silence after which a link counts as dead; the desktop ticks every 15s. */
  staleMs?: number;
  codec?: Codec;
}

type Result<M extends RemoteMethod> = Awaited<ReturnType<RemoteApi[M]>>;

export class RemoteClient {
  status: RemoteStatus = "offline";
  private target: Start;
  private socket?: WebSocket;
  private channel?: Channel;
  private calls = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: any }
  >();
  private nextCall = 1;
  private closed = true;
  private retry = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  /** When the desktop was last heard from. */
  private heard = 0;
  private attempt = 0;
  /** The host the link runs over, once online. */
  private host?: string;
  /** Routes being tried that haven't answered yet; each cancels itself. */
  private dials = new Set<() => void>();
  private betterTimer?: ReturnType<typeof setInterval>;
  /** When each host last failed to beat the current route, so a flaky one isn't retried every round. */
  private worse = new Map<string, number>();
  /** The connected desktop's bridge version; older desktops don't say. */
  private bridge?: number;
  /** What the desktop patches next, from this connection's events: answers still streaming and the thread list. */
  private streaming = new Map<string, ChatMessage>();
  private chats?: RemoteChatSummary[];
  constructor(private options: RemoteClientOptions) {
    this.target = options.start;
  }
  /** The desktop's name, from the link or the saved credentials. */
  get name() {
    return "link" in this.target ? this.target.link.name : this.target.name;
  }
  start() {
    if (!this.closed) return;
    this.closed = false;
    void this.connect();
  }
  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.cancelDials();
    this.drop("Disconnected.");
    this.setStatus("offline");
  }
  /** Which way the link runs now. */
  get route(): { host: string; kind: RouteKind } | undefined {
    return this.status === "online" && this.host
      ? { host: this.host, kind: routeKind(this.host) }
      : undefined;
  }
  get routes(): readonly RouteKind[] {
    return ("link" in this.target ? undefined : this.target.routes) ??
      defaultRoutes;
  }
  /** A new order: kept with the credentials, and the link moves if an earlier route answers. */
  setRoutes(routes: RouteKind[]) {
    if ("link" in this.target) return;
    this.target = { ...this.target, routes };
    this.options.onCredentials?.(this.target);
    this.worse.clear();
    this.tryBetter();
  }
  /**
   * Reconnects now instead of waiting out the backoff, e.g. when the app
   * returns to the foreground. A link that went quiet for more than a tick
   * while the app was away is likely dead (Android drops sockets in the
   * background without telling), so it reconnects rather than wait for the
   * watchdog.
   */
  wake() {
    if (this.closed || this.status === "denied") return;
    const quiet =
      this.status === "online" &&
      Date.now() - this.heard > (this.options.staleMs ?? 40000) / 2;
    if (this.status === "offline" || quiet) {
      if (quiet) this.drop("Connection lost.");
      clearTimeout(this.retryTimer);
      this.retry = 0;
      void this.connect();
    } else if (this.status === "online") {
      // Back on the home Wi-Fi, say: worth a look for the shorter way at once.
      this.worse.clear();
      this.tryBetter();
    }
  }
  call<M extends RemoteMethod>(
    method: M,
    ...args: Parameters<RemoteApi[M]>
  ): Promise<Result<M>> {
    return this.request(
      method,
      args,
      slowRemoteMethods.includes(method)
        ? (this.options.slowTimeoutMs ?? 120_000)
        : (this.options.timeoutMs ?? 15000),
    );
  }
  private request<M extends RemoteMethod>(
    method: M,
    args: unknown[],
    timeoutMs: number,
  ): Promise<Result<M>> {
    if (this.status !== "online" || !this.channel)
      return Promise.reject(new Error(`Not connected to ${this.name}.`));
    const id = this.nextCall++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Unanswered(`${this.name} didn't answer in time.`));
      }, timeoutMs);
      this.calls.set(id, { resolve, reject, timer });
      this.sendFrame({ t: "call", id, method, args });
    });
  }
  /** One of the desktop's own calls on the phone's allowlist, typed as the desktop's Api. */
  desktop<M extends PhoneDesktopMethod>(
    method: M,
    ...args: DesktopCall<M>["args"]
  ): Promise<DesktopCall<M>["result"]> {
    // JSON turns a left-out optional argument into null, which the desktop's
    // validation rightly refuses; trailing ones simply go.
    const sent: unknown[] = [...args];
    while (sent.length && sent.at(-1) === undefined) sent.pop();
    // Older desktops refuse a send's `to`; the mention buildSend leaves in
    // its body tells them the same.
    if (method === "sendProjectChat" && (this.bridge ?? 0) < recipientBridge) {
      const { to: _, ...send } = sent[1] as { to?: unknown };
      sent[1] = send;
    }
    return this.request(
      "desktop",
      [method, sent],
      slowPhoneMethods.includes(method)
        ? (this.options.slowTimeoutMs ?? 120_000)
        : (this.options.timeoutMs ?? 15000),
    ) as Promise<DesktopCall<M>["result"]>;
  }
  private setStatus(status: RemoteStatus, detail?: string) {
    this.status = status;
    this.options.onStatus?.(status, detail);
  }
  private get hosts() {
    const t = this.target;
    return "link" in t
      ? { hosts: t.link.hosts, port: t.link.port, key: t.link.key }
      : { hosts: t.hosts, port: t.port, key: t.key };
  }
  private connect() {
    const attempt = ++this.attempt;
    this.cancelDials();
    this.setStatus("connecting");
    const order = orderHosts(this.hosts.hosts, this.routes);
    let reason = `Can't reach ${this.name}.`;
    this.race(order, {
      stale: () => this.closed || attempt !== this.attempt,
      claim: (link) => {
        this.attach(link);
        return true;
      },
      failed: (error) => {
        if (error instanceof Denied) {
          this.closed = true;
          this.setStatus("denied", error.message);
          return;
        }
        reason = error.message || reason;
      },
      done: () => {
        this.setStatus("offline", reason);
        this.scheduleRetry();
      },
    });
  }
  /**
   * Dials the hosts in order, each a little after the one before unless that
   * one already failed, and keeps the first that signs in. A pairing code
   * works once, so when pairing, the first channel to open alone sends it.
   */
  private race(
    order: string[],
    on: {
      stale: () => boolean;
      claim: (link: Link) => boolean;
      failed?: (error: Error) => void;
      done: () => void;
    },
  ) {
    const { port, key } = this.hosts;
    const serverKey = fromBase64Url(key);
    const stagger = this.options.staggerMs ?? 1500;
    const pairing = "link" in this.target;
    const mine = new Set<() => void>();
    let next = 0,
      won = false,
      signing: (() => void) | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      for (const cancel of mine) {
        cancel();
        this.dials.delete(cancel);
      }
    };
    const launch = () => {
      clearTimeout(timer);
      if (won || signing || on.stale() || next >= order.length) return;
      const host = order[next++]!;
      const cancel = this.dial(host, port, serverKey, {
        signIn: () => {
          if (!pairing) return true;
          if (won || signing || on.stale()) return false;
          signing = cancel;
          clearTimeout(timer);
          for (const other of mine)
            if (other !== cancel) {
              other();
              mine.delete(other);
              this.dials.delete(other);
            }
          return true;
        },
        claim: (link) => {
          mine.delete(cancel);
          this.dials.delete(cancel);
          if (won || on.stale() || !on.claim(link)) return false;
          won = true;
          settle();
          return true;
        },
        failed: (error) => {
          mine.delete(cancel);
          this.dials.delete(cancel);
          if (signing === cancel) signing = undefined;
          if (won || on.stale()) return;
          on.failed?.(error);
          // A refusal from the pinned desktop holds for every route.
          if (error instanceof Denied) return settle();
          if (next < order.length) launch();
          else if (!mine.size) on.done();
        },
      });
      mine.add(cancel);
      this.dials.add(cancel);
      if (next < order.length) timer = setTimeout(launch, stagger);
    };
    if (!order.length) on.done();
    else launch();
  }
  private cancelDials() {
    for (const cancel of this.dials) cancel();
    this.dials.clear();
  }
  private scheduleRetry() {
    clearTimeout(this.retryTimer);
    const delay = Math.min(15000, 1000 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }
  /** Takes a signed-in link as the connection, the desktop's word on its addresses with it. */
  private attach({ socket, channel, host, frame }: Link) {
    this.socket = socket;
    this.channel = channel;
    this.host = host;
    this.bridge = frame.bridge;
    this.streaming.clear();
    this.chats = undefined;
    const fresh = frame.hosts?.filter(validHost);
    if (frame.t === "paired" && "link" in this.target) {
      const { link } = this.target;
      this.target = {
        hosts: fresh?.length ? learnHosts(fresh, host) : link.hosts,
        port: link.port,
        key: link.key,
        name: frame.name,
        deviceId: frame.deviceId,
        token: frame.token,
      };
      this.options.onPaired?.(this.target);
    } else if (!("link" in this.target)) {
      const hosts = fresh?.length
        ? learnHosts(fresh, host)
        : this.target.hosts;
      const changed =
        hosts.join(",") !== this.target.hosts.join(",") ||
        frame.name !== this.target.name;
      this.target = { ...this.target, name: frame.name, hosts };
      if (changed) this.options.onCredentials?.(this.target);
    }
    this.retry = 0;
    this.keepAlive(socket);
    this.watchRoutes();
    this.setStatus("online");
  }
  /** While the link runs over a later route than it could, looks for an earlier one now and then. */
  private watchRoutes() {
    clearInterval(this.betterTimer);
    this.betterTimer = undefined;
    if (!this.better().length) return;
    this.betterTimer = setInterval(
      () => this.tryBetter(),
      this.options.betterRouteMs ?? 60_000,
    );
  }
  /** Hosts ahead of the current one in the order, but not those that just lost to it. */
  private better() {
    const order = orderHosts(this.hosts.hosts, this.routes);
    const at = this.host ? order.indexOf(this.host) : -1;
    const cooled = Date.now() - 5 * 60_000;
    return (at < 0 ? [] : order.slice(0, at)).filter(
      (h) => (this.worse.get(h) ?? 0) < cooled,
    );
  }
  /**
   * Signs in over an earlier route beside the running link and swaps to it
   * once it's in, so nothing shows as offline. Only between calls: an answer
   * on its way comes back on the socket it went out on.
   */
  private tryBetter() {
    if (this.status !== "online" || this.dials.size) return;
    const hosts = this.better();
    if (!hosts.length) return this.watchRoutes();
    const socket = this.socket;
    let busy = false;
    this.race(hosts, {
      stale: () => this.closed || this.socket !== socket,
      claim: (link) => {
        if (this.calls.size) return !(busy = true);
        const old = this.socket;
        if (old) {
          old.onclose = old.onmessage = old.onerror = old.onopen = null;
          try {
            old.close();
          } catch {}
        }
        clearTimeout(this.watchdog);
        this.attach(link);
        return true;
      },
      failed: () => {},
      done: () => {
        if (!busy) for (const host of hosts) this.worse.set(host, Date.now());
        this.watchRoutes();
      },
    });
  }
  /**
   * One route: connects, opens the channel under the pinned key and signs in.
   * `claim` decides whether the signed-in link is wanted; after that its
   * frames are the connection's. Returns a cancel for while it's dialing.
   */
  private dial(
    host: string,
    port: number,
    serverKey: Uint8Array,
    on: {
      /** The channel is open; false leaves this route before it signs in. */
      signIn: () => boolean;
      claim: (link: Link) => boolean;
      failed: (error: Error) => void;
    },
  ): () => void {
    const Socket = this.options.WebSocket ?? globalThis.WebSocket;
    const url = `ws://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}/`;
    const codec = this.options.codec ?? jsCodec;
    const socket = new Socket(url);
    socket.binaryType = "arraybuffer";
    const handshake = clientHandshake(serverKey);
    let channel: Channel | undefined;
    let state: "dialing" | "won" | "done" = "dialing";
    const quit = () => {
      clearTimeout(timer);
      socket.onclose = socket.onmessage = socket.onerror = socket.onopen = null;
      try {
        socket.close();
      } catch {}
    };
    const fail = (error: Error) => {
      if (state !== "dialing") return;
      state = "done";
      quit();
      on.failed(error);
    };
    const timer = setTimeout(
      () => fail(new Error(`${host} didn't answer.`)),
      this.options.timeoutMs ?? 15000,
    );
    socket.onopen = () => socket.send(JSON.stringify(handshake.hello));
    socket.onerror = () => fail(new Error(`Can't reach ${this.name}.`));
    socket.onclose = () => {
      if (state === "dialing") return fail(new Error(`Can't reach ${this.name}.`));
      if (state === "won" && this.socket === socket) this.lost();
    };
    socket.onmessage = (message) => {
      const data =
        message.data instanceof ArrayBuffer
          ? new Uint8Array(message.data)
          : message.data;
      if (typeof data !== "string" && !(data instanceof Uint8Array))
        return socket.close();
      let opened: ServerFrame | undefined;
      try {
        if (!channel) {
          if (typeof data !== "string") throw new Error();
          channel = handshake.finish(JSON.parse(data) as HelloFrame);
          if (!on.signIn()) {
            state = "done";
            return quit();
          }
          // Sealed whole: nothing compact before the desktop says it reads it.
          socket.send(
            sealFrame(
              channel,
              "link" in this.target
                ? {
                    t: "pair",
                    code: this.target.link.code,
                    device: this.target.device,
                    ...(this.target.kind ? { kind: this.target.kind } : {}),
                    bridge: remoteBridgeVersion,
                  }
                : {
                    t: "auth",
                    deviceId: this.target.deviceId,
                    token: this.target.token,
                    bridge: remoteBridgeVersion,
                  },
              false,
              codec,
            ),
          );
          return;
        }
        const frame = openFrame(channel, data, codec) as ServerFrame;
        if (state === "dialing") {
          if (frame.t === "denied") return fail(new Denied(frame.reason));
          if (frame.t !== "paired" && frame.t !== "ready")
            return fail(new Error("Unexpected answer from Relay."));
          clearTimeout(timer);
          if (!on.claim({ socket, channel, host, frame })) {
            state = "done";
            return quit();
          }
          state = "won";
          return;
        }
        if (state !== "won") return;
        this.keepAlive(socket);
        opened = frame;
      } catch {
        // Anything that doesn't open under the pinned key isn't our desktop.
        if (state === "dialing")
          return fail(new Error(`Couldn't verify ${this.name}. Pair again.`));
        socket.close();
        return;
      }
      // A listener's or a patch's failure is ours, not the desktop's: the link stays.
      try {
        this.receive(opened);
      } catch (error) {
        console.warn(`Couldn't take in what ${this.name} sent:`, error);
      }
    };
    return () => {
      if (state !== "dialing") return;
      state = "done";
      quit();
    };
  }
  private receive(frame: ServerFrame) {
    if (
      frame.t === "tick" &&
      frame.hosts &&
      !("link" in this.target) &&
      this.host
    ) {
      // A network can change without dropping the wildcard listener or the
      // existing Tailscale connection. Keep the next connect's routes current.
      const hosts = learnHosts(frame.hosts.filter(validHost), this.host);
      if (hosts.join(",") === this.target.hosts.join(",")) return;
      this.target = { ...this.target, hosts };
      this.options.onCredentials?.(this.target);
      this.worse.clear();
      this.watchRoutes();
      this.tryBetter();
    } else if (frame.t === "result") {
      const call = this.calls.get(frame.id);
      if (!call) return;
      this.calls.delete(frame.id);
      clearTimeout(call.timer);
      if (frame.ok) call.resolve(frame.value);
      else call.reject(new Error(frame.error));
    } else if (frame.t === "event") {
      if (frame.s !== undefined) this.sendFrame({ t: "got", s: frame.s });
      const event = this.rebuild(frame.event);
      if (event) this.options.onEvent?.(event);
    } else if (frame.t === "denied") {
      this.closed = true;
      this.drop(frame.reason);
      this.setStatus("denied", frame.reason);
    }
  }
  private rebuild(event: WireEvent): RemoteEvent | undefined {
    if (event.kind === "messagePatch") {
      const prev = this.streaming.get(event.patch.id);
      // Can't be, both ends start over with each connection; the final answer comes whole.
      if (!prev) return;
      const { patch, ...rest } = event;
      event = {
        ...rest,
        kind: "message",
        message: applyMessagePatch(prev, patch),
      };
    } else if (event.kind === "chatsPatch") {
      if (!this.chats) return;
      event = {
        kind: "chats",
        chats: applyChatsPatch(this.chats, event.patch),
      };
    }
    if (event.kind === "message") {
      if (event.message.status === "streaming")
        this.streaming.set(event.message.id, event.message);
      else this.streaming.delete(event.message.id);
    } else if (event.kind === "chats") this.chats = event.chats;
    return event;
  }
  private lost() {
    this.drop("Connection lost.");
    if (this.closed || this.status === "denied") return;
    this.setStatus("offline", "Connection lost.");
    this.scheduleRetry();
  }
  private keepAlive(socket: WebSocket) {
    this.heard = Date.now();
    clearTimeout(this.watchdog);
    // Gone at once: a polite close over a dead network can take Android a
    // minute, all the while showing the phone as connected.
    this.watchdog = setTimeout(() => {
      if (this.socket === socket) this.lost();
    }, this.options.staleMs ?? 40000);
  }
  private sendFrame(frame: ClientFrame) {
    const compact = (this.bridge ?? 0) >= compactBridge;
    this.socket?.send(
      sealFrame(this.channel!, frame, compact, this.options.codec ?? jsCodec),
    );
  }
  private drop(reason: string) {
    clearTimeout(this.watchdog);
    clearInterval(this.betterTimer);
    this.betterTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.channel = undefined;
    this.host = undefined;
    this.bridge = undefined;
    this.streaming.clear();
    this.chats = undefined;
    if (socket) {
      socket.onclose = socket.onmessage = socket.onerror = socket.onopen = null;
      try {
        socket.close();
      } catch {}
    }
    for (const call of this.calls.values()) {
      clearTimeout(call.timer);
      call.reject(new Unanswered(reason));
    }
    this.calls.clear();
  }
}

class Denied extends Error {}

interface Link {
  socket: WebSocket;
  channel: Channel;
  host: string;
  frame: Extract<ServerFrame, { t: "paired" | "ready" }>;
}

/** The call went out but no answer came back: the desktop may have done it all the same. */
export class Unanswered extends Error {}
