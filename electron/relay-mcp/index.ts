// Relay's own MCP tools: where they're served and which thread is calling.
// The port stays the same across restarts and the agent host's versions, so
// a session started before either still reaches them; each thread's token
// is derived from a secret, so nothing has to remember it.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import type { RenderMode } from "../../shared/html-render";
import {
  DEV_PARAM,
  IMPORT_PARAM,
  PAGES_PARAM,
  SIDE_PATH,
  STARTED_PATH,
} from "./tool-lists";

export { serveRelayTools, type McpHandlers } from "./server";

/** The MCP server name Relay's tools go by, so Claude reaches them as `mcp__relay__…`. */
export const RELAY_SERVER = "relay";

export { relayToolLabel, relayToolsWhere } from "./tool-meta";
export { startedNote } from "./started-note";
export {
  relayToolSchemas,
  relayToolList,
  toolText,
  resultText,
  MESSAGE_CHARS,
  STARTED_LIMIT,
  WAIT_LIMIT_SECONDS,
  scheduleWeekdays,
  type RelayToolName,
  type RelayToolArgs,
  type ToolResult,
} from "./tools";
export {
  SIDE_PATH,
  startedToolList,
  STARTED_PATH,
  startedTools,
} from "./tool-lists";

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

/**
 * Whether another app answers on `port`: not Relay's tools (an agent host's,
 * which keeps serving across restarts) and not nobody.
 */
export async function takenByAnother(port: number) {
  try {
    // No token: only Relay's tools turn it down in their own words.
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    });
    return !(res.status === 401 && (await res.text()).includes("Not a Relay thread."));
  } catch (error) {
    // Something that doesn't speak HTTP; nobody there, a reset or a timeout
    // could be a host coming or going.
    const code = (error as { cause?: { code?: unknown } }).cause?.code;
    return typeof code === "string" && code.startsWith("HPE_");
  }
}

/**
 * The saved port and secret, made on first use; `dir` must exist. A port
 * another app took since is given up for a new one, which the agent host
 * reads before each try to serve; sessions started on the old one lose the
 * tools until they start again.
 */
export async function loadRelayMcp(dir: string): Promise<RelayMcpConfig> {
  const saved = readRelayMcp(dir);
  if (saved && !(await takenByAnother(saved.port))) return saved;
  const config = {
    port: await freePort(),
    secret: saved?.secret ?? randomBytes(32).toString("hex"),
  };
  if (saved)
    console.warn(
      `Another app took port ${saved.port}, where Relay's tools were served; they move to ${config.port}.`,
    );
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

/** Who reaches the tools: a thread, one another thread started, or a side conversation of one. */
export type RelayCaller = "thread" | "started" | "side";

const pathOf: Record<RelayCaller, string> = {
  thread: "/mcp",
  started: STARTED_PATH,
  side: SIDE_PATH,
};

/** What an agent session needs to reach the tools as `chatId`. */
export function relayToolsFor(
  chatId: string,
  caller: RelayCaller,
  renders: RenderMode = "auto",
  /** The thread was opened to import another app's history. */
  imports = false,
) {
  const query = new URLSearchParams();
  if (renders === "off") query.set(PAGES_PARAM, "off");
  if (imports) query.set(IMPORT_PARAM, "on");
  // scripts/dev.mjs sets it; electron/app/dev-build.ts restarts through it.
  if (process.env.RELAY_DEV_STALE) query.set(DEV_PARAM, "on");
  return current
    ? {
        url: `http://127.0.0.1:${current.port}${pathOf[caller]}${query.size ? `?${query}` : ""}`,
        token: relayToken(current.secret, chatId),
        renders,
      }
    : undefined;
}
