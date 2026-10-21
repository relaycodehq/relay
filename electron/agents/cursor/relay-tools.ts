// Relay's own MCP tools, handed to Cursor as the SDK's in-process custom tools
// rather than as an MCP server: the SDK fails MCP server calls closed on
// sandboxed and Auto-review runs, while custom tools never wait for approval.
// Runs in the Cursor worker, so it only uses Node.
import { request } from "node:http";
import type { SDKCustomTool, SDKCustomToolResult } from "@cursor/sdk";
import type { CursorRun } from "./protocol";
import { errorMessage } from "../../../shared/error-message";

type RelayTools = NonNullable<CursorRun["relayTools"]>;

interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: SDKCustomTool["inputSchema"];
  annotations?: SDKCustomTool["annotations"];
}

/**
 * One JSON-RPC call. Plain http rather than fetch: a wait for started threads
 * outlasts fetch's five-minute wait for the response headers.
 */
function relayCall(
  tools: RelayTools,
  method: string,
  params: unknown,
  signal: AbortSignal,
): Promise<any> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return new Promise((resolve, reject) => {
    const req = request(
      tools.url,
      {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          authorization: `Bearer ${tools.token}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          let reply: any;
          try {
            reply = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return reject(
              new Error(`Relay's tools answered ${res.statusCode}.`),
            );
          }
          if (reply?.error)
            reject(
              new Error(String(reply.error.message ?? "Relay's tools failed.")),
            );
          else resolve(reply?.result);
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

const failed = (error: unknown): SDKCustomToolResult => ({
  content: [
    {
      type: "text",
      text: errorMessage(error),
    },
  ],
  isError: true,
});

/** Relay's tools as Cursor custom tools; none when Relay's tools can't be reached. */
export async function relayCustomTools(
  tools: RelayTools,
  signal: AbortSignal,
): Promise<Record<string, SDKCustomTool>> {
  let listed: ListedTool[];
  try {
    listed = (await relayCall(tools, "tools/list", {}, signal))?.tools ?? [];
  } catch (error) {
    console.error("Relay's tools couldn't be listed for Cursor:", error);
    return {};
  }
  return Object.fromEntries(
    listed.map((tool): [string, SDKCustomTool] => [
      tool.name,
      {
        ...(tool.description ? { description: tool.description } : {}),
        ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        execute: async (args) => {
          try {
            const result = await relayCall(
              tools,
              "tools/call",
              { name: tool.name, arguments: args },
              signal,
            );
            return {
              content: result?.content ?? [],
              ...(result?.isError ? { isError: true } : {}),
            };
          } catch (error) {
            return failed(error);
          }
        },
      },
    ]),
  );
}
