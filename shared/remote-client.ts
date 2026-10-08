/**
 * The phone's connection to the desktop bridge. No React Native here: the
 * desktop's tests drive this exact client against the real bridge.
 */
import type { ChatMessage } from "./projects";
import { clientHandshake, fromBase64Url, type Channel } from "./remote-crypto";
import { applyChatsPatch, applyMessagePatch } from "./remote-delta";
import { jsCodec, openFrame, sealFrame, type Codec } from "./remote-wire";
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
  /** Per host while connecting, and per call. */
  timeoutMs?: number;
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
  private preferred = 0;
  private attempt = 0;
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
    this.drop("Disconnected.");
    this.setStatus("offline");
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
        reject(new Error(`${this.name} didn't answer in time.`));
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
  private async connect() {
    const attempt = ++this.attempt;
    this.setStatus("connecting");
    const { hosts, port, key } = this.hosts;
    const order = [
      ...hosts.slice(this.preferred),
      ...hosts.slice(0, this.preferred),
    ];
    let reason = `Can't reach ${this.name}.`;
    for (const host of order) {
      if (this.closed || attempt !== this.attempt) return;
      try {
        await this.open(host, port, fromBase64Url(key));
        this.preferred = hosts.indexOf(host);
        this.retry = 0;
        return;
      } catch (e) {
        this.drop("Connection lost.");
        if (e instanceof Denied) {
          this.closed = true;
          this.setStatus("denied", e.message);
          return;
        }
        reason = e instanceof Error ? e.message : reason;
      }
    }
    if (this.closed || attempt !== this.attempt) return;
    this.setStatus("offline", reason);
    this.scheduleRetry();
  }
  private scheduleRetry() {
    clearTimeout(this.retryTimer);
    const delay = Math.min(15000, 1000 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }
  /** Resolves once authenticated; later failures reconnect by themselves. */
  private open(host: string, port: number, serverKey: Uint8Array) {
    const Socket = this.options.WebSocket ?? globalThis.WebSocket;
    const url = `ws://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}/`;
    return new Promise<void>((resolve, reject) => {
      const socket = new Socket(url);
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      const handshake = clientHandshake(serverKey);
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new Error(`${host} didn't answer.`)),
        this.options.timeoutMs ?? 15000,
      );
      socket.onopen = () => socket.send(JSON.stringify(handshake.hello));
      socket.onerror = () => fail(new Error(`Can't reach ${this.name}.`));
      socket.onclose = () => {
        if (!settled) return fail(new Error(`Can't reach ${this.name}.`));
        if (this.socket === socket) this.lost();
      };
      socket.onmessage = (message) => {
        const data =
          message.data instanceof ArrayBuffer
            ? new Uint8Array(message.data)
            : message.data;
        if (typeof data !== "string" && !(data instanceof Uint8Array))
          return socket.close();
        try {
          if (!this.channel) {
            if (typeof data !== "string") throw new Error();
            this.channel = handshake.finish(JSON.parse(data) as HelloFrame);
            this.sendFrame(
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
            );
            return;
          }
          const frame = openFrame(
            this.channel,
            data,
            this.options.codec ?? jsCodec,
          ) as ServerFrame;
          this.keepAlive(socket);
          if (!settled) {
            if (frame.t === "denied") return fail(new Denied(frame.reason));
            if (frame.t === "paired" || frame.t === "ready")
              this.bridge = frame.bridge;
            if (frame.t === "paired" && "link" in this.target) {
              const { link } = this.target;
              this.target = {
                hosts: link.hosts,
                port: link.port,
                key: link.key,
                name: frame.name,
                deviceId: frame.deviceId,
                token: frame.token,
              };
              this.options.onPaired?.(this.target);
            } else if (frame.t === "ready") {
              if (!("link" in this.target))
                this.target = { ...this.target, name: frame.name };
            } else return fail(new Error("Unexpected answer from Relay."));
            settled = true;
            clearTimeout(timer);
            this.setStatus("online");
            resolve();
            return;
          }
          this.receive(frame);
        } catch {
          // Anything that doesn't open under the pinned key isn't our desktop.
          fail(new Error(`Couldn't verify ${this.name}. Pair again.`));
          socket.close();
        }
      };
    });
  }
  private receive(frame: ServerFrame) {
    if (frame.t === "result") {
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
    const socket = this.socket;
    this.socket = undefined;
    this.channel = undefined;
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
      call.reject(new Error(reason));
    }
    this.calls.clear();
  }
}

class Denied extends Error {}
