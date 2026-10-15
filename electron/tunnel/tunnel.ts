import { connect, type Socket } from "node:net";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  maxTunnelStreams,
  tunnelChunk,
  tunnelWindow,
  type TunnelFrame,
} from "../../shared/remote-tunnel";

/** IPv4 first; Node and Vite often bind "localhost" to ::1 alone. */
const loopback = ["127.0.0.1", "::1"];
const connectMs = 5000;
/** Smaller chunks barely deflate. */
const packFrom = 1024;
/**
 * Chunks in a row that didn't shrink before a stream stops deflating, and how
 * many it then sends as they are before trying again: media doesn't shrink,
 * but a kept-alive connection can carry a script after an image.
 */
const packGiveUp = 2;
const packRetryAfter = 32;

export interface TunnelOptions {
  /** Ports a phone may not reach: the bridge's own. */
  refused(): number[];
  /** Whether the phone may reach `port`: one Sites lists, or one typed into its address bar. */
  allowed?(port: number): Promise<boolean>;
  /** Smaller in tests; both ends must agree on it. */
  window?: number;
  maxStreams?: number;
}

interface Stream {
  id: number;
  port: number;
  socket?: Socket;
  /** Bytes the phone will still take before it credits more. */
  credit: number;
  /** Read from the server, waiting for credit; at most about one read. */
  held: Buffer[];
  heldBytes: number;
  /** Chunks in a row that deflating didn't shrink. */
  unshrunk: number;
  /** Chunks still to send as they are before deflating again. */
  rawFor: number;
  /** Received from the phone and not credited back yet. */
  unacked: number;
  /** Of `unacked`, what the server's socket has taken. */
  consumed: number;
  /** The server's side ended; `end` goes once `held` is out. */
  readDone?: boolean;
  endSent?: boolean;
  /** The phone's side ended. */
  phoneEnded?: boolean;
  /** The socket closed without an error; `close` goes once `held` is out. */
  closing?: boolean;
  error?: string;
}

/**
 * One phone connection's end of the port tunnel (shared/remote-tunnel): each
 * stream the phone opens becomes a TCP connection to this computer's own
 * loopback, never another host, piped both ways under the phone's credit.
 */
export class Tunnel {
  private streams = new Map<number, Stream>();
  private done = false;
  private window: number;
  private maxStreams: number;
  constructor(
    private send: (frame: TunnelFrame) => void,
    private options: TunnelOptions,
  ) {
    this.window = options.window ?? tunnelWindow;
    this.maxStreams = options.maxStreams ?? maxTunnelStreams;
  }

  get size() {
    return this.streams.size;
  }

  /** Bytes read from servers that wait for the phone's credit. */
  get held() {
    let bytes = 0;
    for (const s of this.streams.values()) bytes += s.heldBytes;
    return bytes;
  }

  receive(frame: TunnelFrame) {
    if (this.done) return;
    if (frame.op === "open") return this.open(frame.stream, frame.port);
    const s = this.streams.get(frame.stream);
    if (!s) return;
    switch (frame.op) {
      case "data":
      case "packed":
        return this.write(s, frame.op, frame.data);
      case "credit":
        s.credit += frame.bytes;
        if (s.credit > this.window)
          return this.fail(s, "The phone credited more than it was sent.");
        return this.pump(s);
      case "end":
        s.phoneEnded = true;
        s.socket?.end();
        return;
      case "close":
        this.streams.delete(s.id);
        s.socket?.destroy();
        return;
      case "opened":
        return this.fail(s, "Only Relay opens streams.");
    }
  }

  /** The phone went away: every stream ends. */
  close() {
    this.done = true;
    for (const s of this.streams.values()) s.socket?.destroy();
    this.streams.clear();
  }

  private open(id: number, port: number) {
    const refuse = (reason: string) =>
      this.send({ op: "close", stream: id, reason });
    const taken = this.streams.get(id);
    if (taken) return this.fail(taken, "That stream is open already.");
    if (port < 1) return refuse("There's no port 0.");
    if (this.options.refused().includes(port))
      return refuse(`Port ${port} is Relay's own.`);
    if (this.streams.size >= this.maxStreams)
      return refuse("Too many connections at once.");
    const s: Stream = {
      id,
      port,
      credit: this.window,
      held: [],
      heldBytes: 0,
      unshrunk: 0,
      rawFor: 0,
      unacked: 0,
      consumed: 0,
    };
    this.streams.set(id, s);
    if (!this.options.allowed) return this.connect(s, refuse);
    this.options.allowed(port).then((ok) => {
      if (this.streams.get(id) !== s) return;
      if (ok) return this.connect(s, refuse);
      this.streams.delete(id);
      refuse(`Port ${port} isn't one of your sites. Type it into the address bar to open it.`);
    }, (e: Error) => {
      if (this.streams.get(id) !== s) return;
      this.streams.delete(id);
      refuse(`Couldn't check port ${port}: ${e.message}`);
    });
  }

  private connect(s: Stream, refuse: (reason: string) => void) {
    const { id, port } = s;
    connectLoopback(port).then(
      (socket) => {
        // The phone gave up meanwhile, or went away.
        if (this.streams.get(id) !== s) return socket.destroy();
        this.attach(s, socket);
        this.send({ op: "opened", stream: id });
      },
      (e: NodeJS.ErrnoException) => {
        if (this.streams.get(id) !== s) return;
        this.streams.delete(id);
        refuse(
          e.code === "ECONNREFUSED"
            ? `Nothing is listening on port ${port}.`
            : e.code === "ETIMEDOUT"
              ? `Port ${port} didn't answer.`
              : `Couldn't reach port ${port}: ${e.code ?? e.message}.`,
        );
      },
    );
  }

  private attach(s: Stream, socket: Socket) {
    s.socket = socket;
    socket.setNoDelay(true);
    socket.on("data", (chunk: Buffer) => {
      s.held.push(chunk);
      s.heldBytes += chunk.length;
      this.pump(s);
    });
    socket.on("end", () => {
      s.readDone = true;
      this.pump(s);
    });
    socket.on("error", (e) => (s.error = e.message));
    socket.on("close", () => {
      if (this.streams.get(s.id) !== s) return;
      if (s.error) return this.fail(s, s.error);
      s.closing = true;
      s.readDone = true;
      this.pump(s);
    });
  }

  /** Server to phone, as far as the phone's credit goes; the socket waits for the rest. */
  private pump(s: Stream) {
    while (s.heldBytes && s.credit > 0) {
      const head = s.held[0]!;
      const n = Math.min(head.length, s.credit, tunnelChunk);
      if (n === head.length) s.held.shift();
      else s.held[0] = head.subarray(n);
      s.heldBytes -= n;
      s.credit -= n;
      this.sendData(s, head.subarray(0, n));
    }
    if (s.heldBytes) return void s.socket?.pause();
    s.socket?.resume();
    if (s.readDone && !s.endSent) {
      s.endSent = true;
      this.send({ op: "end", stream: s.id });
    }
    if (s.closing) {
      this.streams.delete(s.id);
      this.send({ op: "close", stream: s.id, reason: "" });
    }
  }

  private sendData(s: Stream, data: Buffer) {
    const stream = s.id;
    if (data.length >= packFrom && s.rawFor > 0) s.rawFor--;
    else if (data.length >= packFrom) {
      const packed = deflateRawSync(data, { level: 1 });
      if (packed.length < data.length) {
        s.unshrunk = 0;
        return this.send({ op: "packed", stream, data: packed });
      }
      // A retry that doesn't shrink either backs off again at once.
      if (++s.unshrunk >= packGiveUp) {
        s.unshrunk = packGiveUp - 1;
        s.rawFor = packRetryAfter;
      }
    }
    this.send({ op: "data", stream, data });
  }

  /** Phone to server; credit goes back once the socket took a quarter window. */
  private write(s: Stream, op: "data" | "packed", data: Uint8Array) {
    if (!s.socket || s.phoneEnded)
      return this.fail(s, "Data came outside the stream.");
    let bytes: Uint8Array;
    try {
      bytes =
        op === "packed"
          ? inflateRawSync(data, { maxOutputLength: tunnelChunk })
          : data;
    } catch {
      return this.fail(s, "A packed frame didn't unpack.");
    }
    s.unacked += bytes.length;
    if (s.unacked > this.window)
      return this.fail(s, "The phone sent past its window.");
    const n = bytes.length;
    s.socket.write(bytes, (e) => {
      if (e || this.streams.get(s.id) !== s) return;
      s.consumed += n;
      if (s.consumed < this.window / 4) return;
      this.send({ op: "credit", stream: s.id, bytes: s.consumed });
      s.unacked -= s.consumed;
      s.consumed = 0;
    });
  }

  private fail(s: Stream, reason: string) {
    this.streams.delete(s.id);
    s.socket?.destroy();
    this.send({ op: "close", stream: s.id, reason });
  }
}

/** This computer's own `port`, on 127.0.0.1 or else ::1; nowhere else. */
export async function connectLoopback(port: number): Promise<Socket> {
  // IPv4's error says it best: ::1 may not even exist here.
  let first: unknown;
  for (const host of loopback)
    try {
      return await connectTo(host, port);
    } catch (e) {
      first ??= e;
    }
  throw first;
}

function connectTo(host: string, port: number) {
  return new Promise<Socket>((resolve, reject) => {
    // The phone ends its side when its browser does; the server's may end first.
    const socket = connect({ host, port, allowHalfOpen: true });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    }, connectMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
