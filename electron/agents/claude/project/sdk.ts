import { join } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { findExecutable } from "../../../platform/executables";
import { claudeDefaultsFrom } from "../../../../shared/agent-defaults";
import { AsyncQueue } from "../../../util/async-queue";
import { runAccount } from "../../accounts";
import type { AgentOptions } from "../../types";

export async function sdk(): Promise<
  typeof import("@anthropic-ai/claude-agent-sdk")
> {
  // Keep the SDK's ESM runtime intact inside Electron's CommonJS main bundle,
  // and the headless one's, which sits beside its own copy.
  const specifier =
    typeof __dirname !== "undefined" &&
    (__dirname.endsWith("dist-electron") ||
      existsSync(join(__dirname, "claude-sdk.mjs")))
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
  const [{ query }, executable, account] = await Promise.all([
    sdk(),
    findExecutable("claude"),
    // Models and defaults are the account in use's, unless told whose.
    options.env ? undefined : runAccount("claude"),
  ]);
  const input: ClaudeInput = new AsyncQueue();
  const stream = query({
    prompt: input,
    options: {
      pathToClaudeCodeExecutable: executable,
      strictMcpConfig: true,
      mcpServers: {},
      env: account?.env,
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
/** A prompt's screenshots, as the image blocks of a user message. */
export const claudeImages = (images: AgentOptions["images"]) =>
  Promise.all(
    (images ?? []).map(async (image) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: image.mimeType,
        data: (await readFile(image.path)).toString("base64"),
      },
    })),
  );
