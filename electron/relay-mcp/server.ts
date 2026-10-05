// MCP over HTTP, as much of it as Relay's tools need: JSON-RPC posts answered
// with JSON, no event streams, no sessions. The agent host serves it so a
// call outlives a restart of Relay; Relay serves it itself when there's no host.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { relayToolList, toolText, type ToolResult } from "./tools";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const BODY_LIMIT = 1 << 20;

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
      return reply({ tools: relayToolList });
    case "tools/call": {
      const name = request.params?.name;
      if (!relayToolList.some((t) => t.name === name))
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

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("Too large."));
        req.destroy();
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
    if (new URL(req.url ?? "/", "http://relay").pathname !== "/mcp")
      return send(404);
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
    } catch {
      return send(400, failure(null, -32700, "Parse error."));
    }
    const batch = Array.isArray(parsed);
    const requests = (batch ? parsed : [parsed]) as Request[];
    const responses = (
      await Promise.all(
        requests.map((r) => answer(r, chatId, handlers, abort.signal)),
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
