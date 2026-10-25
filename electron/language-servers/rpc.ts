import type { Readable, Writable } from "node:stream";

const HEADER_END = Buffer.from("\r\n\r\n");
const MAX_HEADER_BYTES = 8192;
/** A message past this is a server gone wrong, not a reply. */
const MAX_BODY_BYTES = 256 * 1024 * 1024;

/** Frames a message the way LSP sends it over a pipe. */
export function encodeMessage(message: object) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
    body,
  ]);
}

/**
 * Cuts a byte stream into LSP messages. Chunks end anywhere, inside a header,
 * a multi-byte character or the body, and a body is only joined once it is
 * all here. A body that isn't JSON is skipped; a broken header throws.
 */
export class MessageParser {
  private chunks: Buffer[] = [];
  private size = 0;
  private bodyLength: number | undefined;

  push(chunk: Buffer): unknown[] {
    this.chunks.push(chunk);
    this.size += chunk.length;
    const messages: unknown[] = [];
    for (;;) {
      if (this.bodyLength === undefined) {
        const joined = this.join();
        const end = joined.indexOf(HEADER_END);
        if (end < 0) {
          if (joined.length > MAX_HEADER_BYTES)
            throw new Error("The language server sent a header with no end");
          return messages;
        }
        this.bodyLength = headerLength(joined.subarray(0, end).toString());
        this.take(joined.subarray(end + HEADER_END.length));
      }
      if (this.size < this.bodyLength) return messages;
      const joined = this.join();
      const body = joined.subarray(0, this.bodyLength);
      this.take(joined.subarray(this.bodyLength));
      this.bodyLength = undefined;
      try {
        messages.push(JSON.parse(body.toString("utf8")));
      } catch {
        // One garbled message shouldn't end the session; a request that
        // never gets its answer times out.
      }
    }
  }

  private join() {
    if (this.chunks.length > 1) this.take(Buffer.concat(this.chunks));
    return this.chunks[0] ?? Buffer.alloc(0);
  }

  private take(rest: Buffer) {
    this.chunks = rest.length ? [rest] : [];
    this.size = rest.length;
  }
}

function headerLength(header: string) {
  const match = /^content-length:[ \t]*(\d+)[ \t]*$/im.exec(header);
  const length = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(length) || length > MAX_BODY_BYTES)
    throw new Error("The language server sent an invalid Content-Length");
  return length;
}

/** An error a server answered a request with. */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

/** Cancellations a server answers with when the file changed under a request, or it isn't ready. */
export const isCancelled = (e: unknown) =>
  e instanceof RpcError &&
  (e.code === -32800 || e.code === -32801 || e.code === -32802);

/** The pipes of a language server; a child process has all of them. */
export interface RpcTransport {
  stdin: Writable | null;
  stdout: Readable | null;
}

export type RequestHandler = (method: string, params: unknown) => unknown;
export type NotificationHandler = (method: string, params: unknown) => void;

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/**
 * A JSON-RPC connection to a language server. After `close`, or when the
 * pipe ends, every request waiting is rejected and new ones fail at once.
 */
export class RpcConnection {
  private parser = new MessageParser();
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private closed: Error | undefined;
  private stdin: Writable | null;

  constructor(
    transport: RpcTransport,
    private handlers: {
      /** Answers a request the server makes; throwing sends it an error. */
      request: RequestHandler;
      notification: NotificationHandler;
      /** The stream broke: the framing was wrong, or stdout ended. */
      broken(error: Error): void;
    },
  ) {
    transport.stdin?.on("error", () => {});
    transport.stdout?.on("data", (chunk: Buffer) => this.receive(chunk));
    transport.stdout?.on("end", () => this.fail(new Error("Stream ended")));
    this.stdin = transport.stdin;
  }

  request<T = unknown>(
    method: string,
    params: unknown,
    timeout = 30_000,
  ): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.send({ method: "$/cancelRequest", params: { id } });
        reject(new Error(`${method} timed out`));
      }, timeout);
      this.pending.set(id, {
        method,
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown) {
    if (!this.closed) this.send({ method, params });
  }

  /** Rejects what is waiting with `reason`; later requests reject with it too. */
  close(reason = new Error("The language server was closed")) {
    this.fail(reason, false);
  }

  private send(message: object) {
    this.stdin?.write(encodeMessage(message));
  }

  private fail(error: Error, report = true) {
    if (this.closed) return;
    this.closed = error;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    if (report) this.handlers.broken(error);
  }

  private receive(chunk: Buffer) {
    let messages: unknown[];
    try {
      messages = this.parser.push(chunk);
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    for (const message of messages) this.dispatch(message);
  }

  private dispatch(message: unknown) {
    if (typeof message !== "object" || message === null) return;
    const incoming = message as {
      id?: number | string | null;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    if (typeof incoming.method === "string") {
      if (incoming.id === undefined || incoming.id === null)
        this.handlers.notification(incoming.method, incoming.params);
      else void this.answer(incoming.id, incoming.method, incoming.params);
      return;
    }
    if (typeof incoming.id !== "number") return;
    const request = this.pending.get(incoming.id);
    if (!request) return;
    this.pending.delete(incoming.id);
    clearTimeout(request.timer);
    if (incoming.error)
      request.reject(
        new RpcError(
          incoming.error.message ?? `${request.method} failed`,
          incoming.error.code ?? -32603,
        ),
      );
    else request.resolve(incoming.result ?? null);
  }

  private async answer(id: number | string, method: string, params: unknown) {
    try {
      const result = await this.handlers.request(method, params);
      if (!this.closed) this.send({ id, result: result ?? null });
    } catch (e) {
      if (!this.closed)
        this.send({
          id,
          error: {
            code: e instanceof RpcError ? e.code : -32603,
            message: e instanceof Error ? e.message : String(e),
          },
        });
    }
  }
}
