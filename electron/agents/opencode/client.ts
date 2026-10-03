import { request, type IncomingMessage } from "node:http";
import {
  detachOpenCodeServer,
  openCodeServer,
  stopOpenCodeServer,
} from "./server";

/**
 * A request to Relay's own OpenCode child on 127.0.0.1. Plain `node:http`,
 * not `fetch` or Electron's `net`: no system proxy may sit in between.
 */
function local(
  url: URL,
  options: {
    method: string;
    auth: string;
    body?: string;
    accept?: string;
    signal?: AbortSignal;
  },
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: options.method,
        headers: {
          authorization: options.auth,
          ...(options.accept ? { accept: options.accept } : {}),
          ...(options.body !== undefined
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(options.body),
              }
            : {}),
        },
        signal: options.signal,
      },
      resolve,
    );
    req.on("error", reject);
    req.end(options.body);
  });
}
async function text(response: IncomingMessage) {
  let body = "";
  response.setEncoding("utf8");
  for await (const chunk of response) body += chunk;
  return body;
}

/** An event from OpenCode's bus, e.g. `message.part.updated`; `events.ts` says what is in one. */
export interface OpenCodeEvent {
  type: string;
  properties: unknown;
}
type Listener = (event: OpenCodeEvent) => void;

export class OpenCodeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Calls OpenCode's HTTP API for work in `directory`. */
export async function openCode<T = any>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { directory?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const server = await openCodeServer();
  const url = new URL(path, server.url);
  if (options.directory) url.searchParams.set("directory", options.directory);
  const response = await local(url, {
    method,
    auth: server.auth,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const body = await text(response);
  const status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    let message = body.slice(0, 500);
    try {
      const parsed = JSON.parse(body);
      message = parsed?.data?.message ?? parsed?.message ?? message;
    } catch {}
    throw new OpenCodeError(
      `OpenCode ${method} ${url.pathname} failed (${status}): ${message}`,
      status,
    );
  }
  return (body ? JSON.parse(body) : undefined) as T;
}

const listeners = new Map<string, Set<Listener>>();
let stream: Promise<void> | undefined;

/**
 * Hears every event about `sessionID` until the returned function is called.
 * All sessions share one connection to the server's global event stream.
 */
export async function subscribe(
  sessionID: string,
  listener: Listener,
): Promise<() => void> {
  let set = listeners.get(sessionID);
  if (!set) listeners.set(sessionID, (set = new Set()));
  set.add(listener);
  try {
    await connect();
  } catch (error) {
    unsubscribe(sessionID, listener);
    throw error;
  }
  return () => unsubscribe(sessionID, listener);
}
function unsubscribe(sessionID: string, listener: Listener) {
  const set = listeners.get(sessionID);
  set?.delete(listener);
  if (set && !set.size) listeners.delete(sessionID);
}

/** Resolves once the stream is connected; it reconnects while anyone listens. */
function connect(): Promise<void> {
  if (stream) return stream;
  const connected = (async () => {
    const server = await openCodeServer();
    const response = await local(new URL("/global/event", server.url), {
      method: "GET",
      auth: server.auth,
      accept: "text/event-stream",
    });
    if (response.statusCode !== 200) {
      response.resume();
      throw new Error(
        `OpenCode's event stream did not open (${response.statusCode}).`,
      );
    }
    void read(response).finally(() => {
      stream = undefined;
      // Anyone still waiting on a turn needs the stream back.
      if (listeners.size)
        setTimeout(() => {
          if (listeners.size && !stream)
            connect().catch(() => lost("OpenCode's event stream closed."));
        }, 500);
    });
  })();
  stream = connected.catch((error) => {
    stream = undefined;
    throw error;
  });
  return stream;
}

async function read(body: IncomingMessage) {
  body.setEncoding("utf8");
  let buffer = "";
  try {
    for await (const chunk of body as AsyncIterable<string>) {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) dispatch(data);
      }
      if (buffer.length > 8_000_000) buffer = "";
    }
  } catch {}
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
/** The session an event is about, wherever its type keeps that. */
function sessionOf(properties: unknown) {
  const id = [
    field(properties, "sessionID"),
    field(field(properties, "info"), "sessionID"),
    field(field(properties, "part"), "sessionID"),
  ].find((value) => typeof value === "string");
  return id as string | undefined;
}

function dispatch(data: string) {
  let event: OpenCodeEvent;
  try {
    const parsed = JSON.parse(data);
    event = parsed?.payload ?? parsed;
  } catch {
    return;
  }
  if (typeof event?.type !== "string") return;
  const sessionID = sessionOf(event.properties);
  if (!sessionID) return;
  for (const listener of [...(listeners.get(sessionID) ?? [])]) {
    try {
      listener(event);
    } catch (error) {
      console.warn("OpenCode event listener failed:", error);
    }
  }
}

/** Tells every waiting turn the connection is gone, so none waits forever. */
function lost(message: string) {
  for (const [sessionID, set] of listeners)
    for (const listener of [...set])
      listener({
        type: "relay.stream.lost",
        properties: { sessionID, message },
      });
}

export function disposeOpenCode() {
  lost("Relay is closing.");
  listeners.clear();
  stream = undefined;
  stopOpenCodeServer();
}

/** Relay is restarting: turns stay waiting, and the hosted server carries on. */
export function detachOpenCode() {
  listeners.clear();
  stream = undefined;
  detachOpenCodeServer();
}
