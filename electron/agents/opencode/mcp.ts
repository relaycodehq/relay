// Relay's own MCP tools for an OpenCode thread. OpenCode keeps MCP servers
// per directory, every session there sees all of them, and a call carries
// nothing about the session making it. So each thread gets a server of its
// own under its own name, holding its own token, and every session's rules
// hide the other threads' servers.
import { createHash } from "node:crypto";
import { z } from "zod";
import { WAIT_LIMIT_SECONDS } from "../../relay-mcp/tools";
import type { AgentOptions } from "../types";
import type { McpTool } from "./activity";
import { lenient } from "../schema-kit";
import type { PermissionRule } from "./permissions";

/** What every thread's server is named after; OpenCode prefixes its tools with the name. */
const PREFIX = "relay-";
const relayTool = /^relay-[0-9a-f]{8}_(.+)$/;

type Call = (
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) => Promise<unknown>;

const statusSchema = z.record(
  z.string(),
  lenient(z.object({ status: lenient(z.string()) }).loose()),
);

/** The server name of the thread a token belongs to; the token is the thread's own. */
export const relayServerName = (token: string) =>
  PREFIX + createHash("sha256").update(token).digest("hex").slice(0, 8);

/** OpenCode's own sanitizing of a server or tool name. */
const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * The rules that keep a session to its own thread's tools: no other
 * thread's, and its own without asking, as Codex's `approve` does. Relay
 * asks the user itself where it matters (starting threads).
 */
export function relayToolRules(server: string | undefined): PermissionRule[] {
  return [
    { permission: `${PREFIX}*`, pattern: "*", action: "deny" },
    ...(server
      ? [{ permission: `${server}_*`, pattern: "*", action: "allow" as const }]
      : []),
  ];
}

/**
 * Gives the directory's OpenCode the thread's server, unless it has it
 * connected already; adding again replaces the client, so a call of the
 * thread's still running would be cut off. Returns how to read the MCP
 * tools' names in the turn.
 */
export async function connectRelayTools(
  call: Call,
  relayTools: AgentOptions["relayTools"],
): Promise<McpTool> {
  const listed = await call("GET", "/mcp")
    .then((value) => statusSchema.safeParse(value).data ?? {})
    .catch(() => ({}) as z.infer<typeof statusSchema>);
  if (relayTools) {
    const name = relayServerName(relayTools.token);
    if (listed[name]?.status !== "connected") {
      await call("POST", "/mcp", {
        name,
        config: {
          type: "remote",
          url: relayTools.url,
          headers: { Authorization: `Bearer ${relayTools.token}` },
          // A refused token is not a sign-in to start.
          oauth: false,
          // A wait may hold its call for ten minutes.
          timeout: (WAIT_LIMIT_SECONDS + 60) * 1000,
        },
      }).catch((error) =>
        console.warn("OpenCode could not add Relay's tools:", error),
      );
    }
  }
  const servers = Object.keys(listed)
    .filter((name) => !name.startsWith(PREFIX))
    .map((name) => ({ name, prefix: `${sanitize(name)}_` }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return (tool) => {
    const own = relayTool.exec(tool);
    if (own) return { server: "relay", tool: own[1]! };
    const server = servers.find((s) => tool.startsWith(s.prefix));
    return server
      ? { server: server.name, tool: tool.slice(server.prefix.length) }
      : undefined;
  };
}
