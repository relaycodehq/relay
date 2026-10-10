// MCP over HTTP, as much of it as Relay's tools need: JSON-RPC posts answered
// with JSON, no event streams, no sessions. The agent host serves it so a
// call outlives a restart of Relay; Relay serves it itself when there's no host.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { RENDER_MAX_CHARS, RENDER_MAX_PAGES } from "../../shared/html-render";
import {
  relayToolList,
  startedToolList,
  STARTED_PATH,
  toolText,
  type ToolResult,
} from "./tools";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
type ToolList = typeof relayToolList;
const toolsAt: Record<string, ToolList> = {
  "/mcp": relayToolList,
  [STARTED_PATH]: startedToolList,
};
/**
 * The biggest call the tools allow is show_html at its page cap. A page's
 * chars take up to three bytes each in UTF-8, or two once JSON escapes them,
 * so three times the chars covers either, plus a megabyte for the envelope.
 */
export const BODY_LIMIT = RENDER_MAX_PAGES * RENDER_MAX_CHARS * 3 + (1 << 20);

export interface McpHandlers {
  /** The thread a bearer token belongs to, or undefined for none. */
  verify: (token: string) => string | undefined;
  call: (
    chatId: string,
    name: string,
    args: unknown,
    signal: AbortSignal,
  ) => Promise<ToolResult>;
  log?: (line: string) => void;
}

type Request = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
};
type Response =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: { code: number; message: string };
    };

const failure = (
  id: Request["id"],
  code: number,
  message: string,
): Response => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

async function answer(
  request: Request,
  chatId: string,
  handlers: McpHandlers,
  tools: ToolList,
  signal: AbortSignal,
): Promise<Response | undefined> {
  if (request?.jsonrpc !== "2.0" || typeof request.method !== "string")
    return failure(request?.id, -32600, "Invalid request.");
  // Notifications want no answer.
  if (request.id === undefined) return undefined;
  const reply = (result: unknown): Response => ({
    jsonrpc: "2.0",
    id: request.id!,
    result,
  });
  switch (request.method) {
    case "initialize": {
      const asked = request.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "relay", version: "1" },
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools });
    case "tools/call": {
      const name = request.params?.name;
      if (!tools.some((t) => t.name === name))
        return failure(request.id, -32602, `There is no tool ${String(name)}.`);
      try {
        return reply(
          await handlers.call(
            chatId,
            name,
            request.params?.arguments ?? {},
            signal,
          ),
        );
      } catch (error) {
        return reply(
          toolText(
            error instanceof Error ? error.message : String(error),
            true,
          ),
        );
      }
    }
    default:
      return failure(request.id, -32601, `Relay doesn't do ${request.method}.`);
  }
}

class BodyTooLarge extends Error {}

/**
 * Keeps nothing past the limit but reads it all the same: a socket cut mid-
 * upload reaches the client as a reset before the reply saying why does.
 */
function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        chunks.length = 0;
        reject(new BodyTooLarge());
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Serves Relay's tools on 127.0.0.1:`port`; `ready` settles once it listens or can't. */
export function serveRelayTools(port: number, handlers: McpHandlers) {
  const server: Server = createServer(async (req, res) => {
    const send = (
      status: number,
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(status, {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const tools = toolsAt[new URL(req.url ?? "/", "http://relay").pathname];
    if (!tools) return send(404);
    if (req.method !== "POST") return send(405, undefined, { allow: "POST" });
    const token = /^Bearer\s+(\S+)$/i.exec(
      req.headers.authorization ?? "",
    )?.[1];
    const chatId = token ? handlers.verify(token) : undefined;
    if (!chatId) return send(401, failure(null, -32001, "Not a Relay thread."));
    // A call the agent gave up on, like a wait it was interrupted in, stops here too.
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch (error) {
      if (error instanceof BodyTooLarge)
        return send(
          413,
          failure(
            null,
            -32600,
            `The request is over ${Math.floor(BODY_LIMIT / 1024 / 1024)} MB; send smaller or fewer pages.`,
          ),
          { connection: "close" },
        );
      return send(400, failure(null, -32700, "Parse error."));
    }
    const batch = Array.isArray(parsed);
    const requests = (batch ? parsed : [parsed]) as Request[];
    const responses = (
      await Promise.all(
        requests.map((r) => answer(r, chatId, handlers, tools, abort.signal)),
      )
    ).filter((r): r is Response => !!r);
    if (!responses.length) return send(202);
    send(200, batch ? responses : responses[0]);
  });
  const ready = new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  server.on("error", (error) =>
    handlers.log?.(`relay tools: ${error.message}`),
  );
  server.listen(port, "127.0.0.1");
  return {
    ready,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
