// Relay's own MCP tools: where they're served and which thread is calling.
// The port stays the same across restarts and the agent host's versions, so
// a session started before either still reaches them; each thread's token
// is derived from a secret, so nothing has to remember it.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import { STARTED_PATH } from "./tools";

export { serveRelayTools, type McpHandlers } from "./server";
export {
  relayToolSchemas,
  relayToolList,
  startedToolList,
  STARTED_PATH,
  toolText,
  resultText,
  STARTED_LIMIT,
  startedTools,
  WAIT_LIMIT_SECONDS,
  type RelayToolName,
  type RelayToolArgs,
  type ToolResult,
} from "./tools";

const configSchema = z.object({
  port: z.number().int().min(1024).max(65535),
  secret: z.string().regex(/^[0-9a-f]{64}$/),
});
export type RelayMcpConfig = z.infer<typeof configSchema>;

const configFile = (dir: string) => join(dir, "mcp.json");

/** The saved port and secret, or undefined when Relay hasn't made them yet. */
export function readRelayMcp(dir: string): RelayMcpConfig | undefined {
  try {
    return configSchema.parse(
      JSON.parse(readFileSync(configFile(dir), "utf8")),
    );
  } catch {
    return undefined;
  }
}

/** A port nothing listens on right now. */
function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** The saved port and secret, made on first use; `dir` must exist. */
export async function loadRelayMcp(dir: string): Promise<RelayMcpConfig> {
  const saved = readRelayMcp(dir);
  if (saved) return saved;
  const config = {
    port: await freePort(),
    secret: randomBytes(32).toString("hex"),
  };
  const temp = `${configFile(dir)}.tmp`;
  writeFileSync(temp, JSON.stringify(config), { mode: 0o600 });
  renameSync(temp, configFile(dir));
  return config;
}

const sign = (secret: string, chatId: string) =>
  createHmac("sha256", secret).update(chatId).digest("base64url");

/** The bearer token that names `chatId` to the tools. */
export const relayToken = (secret: string, chatId: string) =>
  `${chatId}.${sign(secret, chatId)}`;

/** The thread a token names, if `secret` signed it. */
export function verifyRelayToken(secret: string, token: string) {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const chatId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(secret, chatId));
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? chatId
    : undefined;
}

let current: RelayMcpConfig | undefined;
/** Relay found or made its config; threads get the tools from now on. */
export function useRelayMcp(config: RelayMcpConfig | undefined) {
  current = config;
}

/** What an agent session needs to reach the tools as `chatId`. */
export function relayToolsFor(chatId: string, started = false) {
  return current
    ? {
        url: `http://127.0.0.1:${current.port}${started ? STARTED_PATH : "/mcp"}`,
        token: relayToken(current.secret, chatId),
      }
    : undefined;
}
