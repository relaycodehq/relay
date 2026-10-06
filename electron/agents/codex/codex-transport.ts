import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { z } from "zod";
import { parseCodexResponse } from "./codex-schemas";

export interface CodexTransport {
  request(method: string, params: unknown): Promise<unknown>;
  /** A request whose answer must match `schema`; one that doesn't throws, naming the method. */
  call<T>(method: string, params: unknown, schema: z.ZodType<T>): Promise<T>;
  notify(method: string, params?: unknown): Promise<void>;
}

/** A request Codex answered with a JSON-RPC error. */
export class CodexRequestError extends Error {
  constructor(
    readonly code: number,
    readonly errorMessage: string,
    readonly data?: unknown,
    readonly method?: string,
  ) {
    super(errorMessage);
    this.name = "CodexRequestError";
  }
}

type Id = string | number;
type RpcError = { code: number; message: string; data?: unknown };
type Pending = {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const MAX_FRAME = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ACTIVE_REQUESTS = 32;

const isId = (value: unknown): value is Id =>
  typeof value === "string" || typeof value === "number";
const isRpcError = (value: unknown): value is RpcError =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { code?: unknown }).code === "number" &&
  typeof (value as { message?: unknown }).message === "string";
const handled = <T>(promise: Promise<T>) => {
  promise.catch(() => {});
  return promise;
};

/** Newline-delimited JSON-RPC (without the `jsonrpc` field) over a Codex app server's stdio. */
export async function withCodexTransport<T>(
  child: ChildProcessWithoutNullStreams,
  onNotification: (method: string, params: unknown) => void,
  onError: (error: Error) => void,
  run: (transport: CodexTransport) => Promise<T>,
  onRequest?: (method: string, params: any) => Promise<unknown>,
): Promise<T> {
  let finished = false;
  let closed: string | undefined;
  let nextId = 1;
  let active = 0;
  let lineBytes = 0;
  let text = "";
  const pending = new Map<string, Pending>();
  const decoder = new StringDecoder("utf8");

  // A failed write also emits `error`; unheard, it crashes the main process.
  child.stdin.on("error", (error) => {
    if (!finished)
      onError(new Error(`The Codex connection closed: ${error.message}`));
  });

  const send = (message: object) =>
    new Promise<void>((resolve, reject) => {
      if (closed || finished)
        return reject(new Error(closed ?? "The Codex connection is closed."));
      child.stdin.write(JSON.stringify(message) + "\n", (error) =>
        error ? reject(error) : resolve(),
      );
    });

  const terminate = (reason: string) => {
    if (closed) return;
    closed = reason;
    child.stdout.off("data", read);
    if (!finished) onError(new Error(reason));
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
    }
    pending.clear();
  };

  const answer = async (id: Id, method: string, params: unknown) => {
    if (active >= MAX_ACTIVE_REQUESTS) {
      const message = "Too many Codex requests are already active.";
      return send({ id, error: { code: -32001, message } });
    }
    active++;
    let reply: object;
    try {
      if (onRequest)
        reply = { id, result: await onRequest(method, params ?? {}) };
      else if (method.endsWith("requestApproval"))
        reply = { id, result: { decision: "decline" } };
      else
        reply = {
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply = { id, error: { code: -32603, message } };
    } finally {
      active--;
    }
    if (!closed) return send(reply);
  };

  const route = (message: Record<string, unknown>) => {
    const { id, method } = message;
    if (typeof method === "string" && isId(id)) {
      // A failed reply already reached onError through stdin's `error`.
      void answer(id, method, message.params).catch(() => {});
    } else if (typeof method === "string" && !("id" in message)) {
      onNotification(method, message.params ?? {});
    } else if (
      isId(id) &&
      (message.error === undefined || isRpcError(message.error))
    ) {
      const request = pending.get(String(id));
      if (!request) return;
      pending.delete(String(id));
      clearTimeout(request.timer);
      const error = message.error as RpcError | undefined;
      if (error)
        request.reject(
          new CodexRequestError(
            error.code,
            error.message,
            error.data,
            request.method,
          ),
        );
      else request.resolve(message.result);
    } else {
      terminate(
        "Codex sent a message that is neither a request, a notification nor an answer.",
      );
    }
  };

  const line = (raw: string) => {
    const trimmed = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!trimmed.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return terminate("Codex sent a line that isn't JSON.");
    }
    if (
      typeof message !== "object" ||
      message === null ||
      Array.isArray(message)
    )
      return terminate("Codex sent a message that isn't a JSON object.");
    try {
      route(message as Record<string, unknown>);
    } catch (error) {
      terminate(error instanceof Error ? error.message : String(error));
    }
  };

  const lines = (chunk: string) => {
    text += chunk;
    // Rescanning a long unfinished frame on every chunk would be quadratic.
    if (!chunk.includes("\n")) return;
    let end: number;
    while (!closed && (end = text.indexOf("\n")) !== -1) {
      const raw = text.slice(0, end);
      text = text.slice(end + 1);
      line(raw);
    }
  };

  // Caps an unfinished line so a malfunctioning Codex can't make us hold unlimited output.
  const fits = (chunk: Buffer) => {
    let start = 0;
    for (
      let end = chunk.indexOf(10);
      end !== -1;
      end = chunk.indexOf(10, start)
    ) {
      if (lineBytes + end - start > MAX_FRAME) return false;
      lineBytes = 0;
      start = end + 1;
    }
    lineBytes += chunk.length - start;
    return lineBytes <= MAX_FRAME;
  };

  function read(chunk: Buffer | string) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    if (!fits(bytes)) return terminate("Codex response frame exceeds 4 MiB.");
    lines(decoder.write(bytes));
  }

  child.stdout.on("data", read);
  child.stdout.on("end", () => {
    if (closed) return;
    lines(decoder.end());
    if (text) line(text);
    terminate("The Codex connection closed.");
  });
  child.stdout.on("error", (error) =>
    terminate(`The Codex connection closed: ${error.message}`),
  );

  const request = (method: string, params: unknown) => {
    if (closed) return handled(Promise.reject(new Error(closed)));
    const id = nextId++;
    const key = String(id);
    return handled(
      new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(key);
          reject(new Error(`Codex didn't answer ${method} within 20 seconds.`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(key, { method, resolve, reject, timer });
        send(
          params === undefined ? { id, method } : { id, method, params },
        ).catch((error) => {
          if (!pending.delete(key)) return;
          clearTimeout(timer);
          reject(error);
        });
      }),
    );
  };

  try {
    return await run({
      request,
      call: async (method, params, schema) =>
        parseCodexResponse(method, schema, await request(method, params)),
      notify: (method, params) =>
        handled(send(params === undefined ? { method } : { method, params })),
    });
  } finally {
    finished = true;
    terminate("The Codex connection is closed.");
    child.stdout.destroy();
    child.stdin.end();
  }
}
