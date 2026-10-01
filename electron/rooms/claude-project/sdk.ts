import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { findExecutable } from "../../executables";
import { claudeDefaultsFrom } from "../../../shared/agent-defaults";
import { AsyncQueue } from "../../async-queue";

export async function sdk(): Promise<
  typeof import("@anthropic-ai/claude-agent-sdk")
> {
  // Keep the SDK's ESM runtime intact inside Electron's CommonJS main bundle.
  const specifier =
    typeof __dirname !== "undefined" && __dirname.endsWith("dist-electron")
      ? pathToFileURL(join(__dirname, "claude-sdk.mjs")).href
      : "@anthropic-ai/claude-agent-sdk";
  return import(specifier);
}
export type ClaudeStream = ReturnType<
  typeof import("@anthropic-ai/claude-agent-sdk").query
>;
export type SDKMessage = import("@anthropic-ai/claude-agent-sdk").SDKMessage;
/** What Relay prompts a session with; closing it ends the session's input. */
export type ClaudeInput = AsyncQueue<SDKUserMessage>;
/** The settings the session runs with; `getSettings` is missing from the SDK's types. */
export async function readSettings(stream: ClaudeStream) {
  const withSettings = stream as ClaudeStream & {
    getSettings?: () => Promise<unknown>;
  };
  return claudeDefaultsFrom(await withSettings.getSettings?.());
}
// SDK sessions ignore the CLI's "Chrome enabled by default"; ask as `claude --chrome` does.
export const chromeArgs = { chrome: null };
/** Runs `work` on a throwaway Claude session with no prompt and no MCP servers; closed after. */
export async function withProbe<T>(
  options: Partial<Options>,
  work: (stream: ClaudeStream) => Promise<T>,
): Promise<T> {
  const [{ query }, executable] = await Promise.all([
    sdk(),
    findExecutable("claude"),
  ]);
  const input: ClaudeInput = new AsyncQueue();
  const stream = query({
    prompt: input,
    options: {
      pathToClaudeCodeExecutable: executable,
      strictMcpConfig: true,
      mcpServers: {},
      ...options,
    },
  });
  try {
    return await work(stream);
  } finally {
    input.close();
    stream.close();
  }
}
