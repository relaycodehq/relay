import { randomUUID } from "node:crypto";
import type {
  EffortLevel,
  Options,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { FoundSession, HostedQuery } from "../../../agent-host/client";
import { z } from "zod";
import { HostedSessions, inAgentHost, savedMeta } from "../../hosted-sessions";
import {
  interactionModeSchema,
  runtimeModeSchema,
} from "../../../../shared/agent-modes";
import { reasoningEffortSchema } from "../../../../shared/settings";
import { SYSTEM_ACCOUNT } from "../../../../shared/agent-accounts";
import { AsyncQueue } from "../../../util/async-queue";
import { settingsEffort } from "../../../../shared/agent-defaults";
import { SubagentTracker } from "../claude-agents";
import { claudePermissionMode, type ClaudeRunOptions } from "./config";
import { readOnlyBashHook } from "../../../agent-host/read-only-bash";
import { ClaudeWork } from "./pending";
import { hostedHandlers, sessionCallbacks } from "./requests";
import { readSettings, sdk, type ClaudeInput, type ClaudeStream } from "./sdk";
import { ClaudeFrames, holdOpen, pump, type ClaudeTurn } from "./stream";

/** What a hosted session keeps with it, to be picked up again after a restart. */
export const hostedMetaSchema = z
  .object({
    signature: z.string(),
    skipsPermissions: z.boolean(),
    options: z
      .object({
        cwd: z.string(),
        model: z.string(),
        effort: z.string(),
        contextWindow: z.literal("200k").optional().catch(undefined),
        runtimeMode: runtimeModeSchema.optional(),
        interactionMode: interactionModeSchema.optional(),
        readOnly: z.boolean().optional(),
        account: z.string().optional(),
        choice: z
          .object({
            model: z.string(),
            fast: z.boolean(),
            // A level only another version knows is the agent's own.
            reasoningEffort: reasoningEffortSchema.catch(""),
          })
          .loose(),
      })
      .loose(),
  })
  .loose();
type HostedMeta = z.infer<typeof hostedMetaSchema>;
/** A thread's Claude Code session, kept between its turns. */
export type ClaudeSession = {
  options: ClaudeRunOptions;
  /** The account its Claude Code signed in as; see agents/accounts. */
  account?: string;
  signature: string;
  /** Launched in full access: only then can it switch into it later. */
  skipsPermissions: boolean;
  input: Pick<ClaudeInput, "push" | "close">;
  controller: AbortController;
  stream: ClaudeStream;
  /** Running in the agent host rather than in Relay. */
  hosted?: HostedQuery;
  /**
   * Picked up after a restart, the session has no turn's options until one
   * runs; questions it asks meanwhile wait for them.
   */
  ready?: { promise: Promise<void>; resolve: () => void };
  /** Settles `unprompted` for a turn picked up after a restart, once it's done. */
  released?: () => void;
  /** Filled for as long as the session lives, so nothing Claude says between turns waits unread. */
  frames: ClaudeFrames;
  turn?: ClaudeTurn;
  /** Settles once an unprompted turn has finished; the next prompt waits for it. */
  unprompted?: Promise<void>;
  plan: string;
  threadId?: string;
  /** Asked for as the session starts; each result confirms it. */
  contextWindow?: number;
  /** The cache lifetime Claude last reported writing with. */
  cacheTtl?: number;
  busy: boolean;
  /** Background work and wake-ups that start Claude's next turn. */
  work: ClaudeWork;
  /** The subagents it started, followed between turns too. */
  agents: SubagentTracker;
};
export const sessions = new HostedSessions<ClaudeSession>({
  provider: "claude",
  name: "Claude",
  kind: "claude",
  close: closeSession,
});
export function closeSession(session: ClaudeSession) {
  session.input.close();
  session.stream.close();
  session.released?.();
}
/** The session's options are a turn's own again. */
export function setOptions(session: ClaudeSession, options: ClaudeRunOptions) {
  session.options = options;
  session.ready?.resolve();
  session.ready = undefined;
}
export function closeClaudeSession(key: string) {
  const session = sessions.get(key);
  sessions.delete(key);
  if (session) closeSession(session);
}
/**
 * Moves a live session to new settings instead of restarting it, which
 * would end the background work and wake-ups it holds. False when it can't:
 * another folder, or full access for a session launched without it.
 */
export async function retune(
  session: ClaudeSession,
  options: ClaudeRunOptions,
) {
  const before = session.options;
  const mode = claudePermissionMode(options);
  if (
    options.cwd !== before.cwd ||
    (options.account ?? SYSTEM_ACCOUNT) !==
      (session.account ?? SYSTEM_ACCOUNT) ||
    options.contextWindow !== before.contextWindow ||
    (mode === "bypassPermissions" && !session.skipsPermissions)
  )
    return false;
  try {
    // Cleared, model and effort fall to Claude Code's built-in ones rather
    // than the settings a fresh session would take, so Default sends those.
    if (options.model !== before.model)
      await session.stream.setModel(
        options.model ||
          (await readSettings(session.stream))?.model ||
          undefined,
      );
    if (
      options.effort !== before.effort ||
      (!options.effort && options.model !== before.model)
    ) {
      let effort = options.effort;
      if (!effort) {
        const defaults = await readSettings(session.stream);
        effort = defaults
          ? settingsEffort(defaults, defaults.appliedModel)
          : "";
      }
      await session.stream.applyFlagSettings({
        effortLevel: (effort as EffortLevel) || null,
      });
    }
    if (mode !== claudePermissionMode(before))
      await session.stream.setPermissionMode(mode);
    return true;
  } catch {
    return false;
  }
}
/** A session for a turn to start. */
export function newSession(
  options: ClaudeRunOptions,
  signature: string,
  controller: AbortController,
): ClaudeSession {
  return {
    options,
    account: options.account,
    signature,
    skipsPermissions: options.runtimeMode === "full-access",
    input: new AsyncQueue<SDKUserMessage>(),
    frames: new ClaudeFrames(),
    controller,
    plan: "",
    busy: true,
    work: new ClaudeWork(),
    agents: new SubagentTracker(),
    // Set as the session starts.
    stream: undefined as unknown as ClaudeStream,
  };
}
/** Starts the session's Claude Code, in the agent host when there is one. */
export async function startSession(
  holder: ClaudeSession,
  config: Options,
  key?: string,
) {
  const hosted = await openHosted(holder, config, key);
  if (hosted) useHosted(holder, hosted);
  else {
    const { promptSubmit, canUseTool, onElicitation } =
      sessionCallbacks(holder);
    const { query } = await sdk();
    holder.stream = query({
      prompt: holder.input as ClaudeInput,
      options: {
        ...config,
        abortController: holder.controller,
        hooks: {
          // Scheduled wake-ups send no stream events; the end of each turn lists them.
          Stop: [
            {
              hooks: [
                async (input) => {
                  holder.work.schedule(input);
                  return {};
                },
              ],
            },
          ],
          // Relay's private environment note reaches Claude without entering the transcript.
          UserPromptSubmit: [{ hooks: [promptSubmit] }],
          ...(holder.options.readOnly
            ? { PreToolUse: [{ matcher: "Bash", hooks: [readOnlyBashHook] }] }
            : {}),
        },
        canUseTool,
        onElicitation,
      },
    });
  }
  watchWindow(holder);
  void pump(holder, holder.stream[Symbol.asyncIterator]());
}
/** Only the CLI knows the model's window (Opus has 1M without a `[1m]` suffix); ask now rather than wait for the first result to report it. */
function watchWindow(holder: ClaudeSession) {
  void holder.stream
    .getContextUsage({ detail: "summary" })
    .then(({ rawMaxTokens }) => {
      if (rawMaxTokens > 0) holder.contextWindow ??= rawMaxTokens;
    })
    .catch(() => {});
}
function openHosted(holder: ClaudeSession, config: Options, key?: string) {
  const { options } = holder;
  const meta: HostedMeta = {
    signature: holder.signature,
    skipsPermissions: holder.skipsPermissions,
    options: {
      cwd: options.cwd,
      model: options.model,
      effort: options.effort,
      contextWindow: options.contextWindow,
      runtimeMode: options.runtimeMode,
      interactionMode: options.interactionMode,
      readOnly: options.readOnly,
      account: options.account,
      choice: options.choice,
    },
  };
  return inAgentHost("Claude", (hosts) =>
    hosts.open({
      key: key ?? `once:${randomUUID()}`,
      meta,
      // The host runs Claude Code with Relay's environment as it is now.
      options: { ...config, env: config.env ?? { ...process.env } },
      hooks: {
        Stop: "record",
        UserPromptSubmit: { ask: true, timeout: 4000 },
        ...(options.readOnly ? { PreToolUse: "readOnlyBash" as const } : {}),
      },
      handlers: hostedHandlers(holder),
    }),
  );
}
function useHosted(holder: ClaudeSession, hosted: HostedQuery) {
  holder.hosted = hosted;
  // It answers every call the session makes of the SDK's query.
  holder.stream = hosted as unknown as ClaudeStream;
  holder.input = { push: (message) => hosted.push(message), close: () => {} };
  holder.controller.signal.addEventListener("abort", () => hosted.abort(), {
    once: true,
  });
}
/**
 * Takes back the sessions the agent host kept running while Relay was away.
 * Keys `owns` rejects, and sessions nobody could use, end. Each one comes
 * back with what it has running; one that was in a turn comes back holding it,
 * for an `adopt` turn to show. Claude starting a turn later calls `unprompted`.
 */
export function reattachClaudeSessions(
  owns: (key: string) => boolean,
  unprompted: (key: string) => () => Promise<void>,
) {
  return sessions.reattach(owns, (found) => {
    const meta = savedMeta(found, hostedMetaSchema);
    return meta
      ? restoreSession(found, meta, unprompted(found.info.key))
      : undefined;
  });
}
function restoreSession(
  found: FoundSession,
  meta: HostedMeta,
  show: () => Promise<void>,
) {
  const { info } = found;
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  const holder = {
    options: {
      ...meta.options,
      prompt: "",
      signal: new AbortController().signal,
      onText: () => {},
      session: {
        key: info.key,
        id: info.threadId,
        onId: async () => {},
        onUnprompted: show,
      },
    },
    signature: meta.signature,
    skipsPermissions: meta.skipsPermissions,
    account: meta.options.account,
    frames: new ClaudeFrames(),
    controller: new AbortController(),
    plan: "",
    busy: false,
    work: new ClaudeWork(),
    agents: new SubagentTracker(),
    threadId: info.threadId,
    ready: { promise, resolve },
  } as unknown as ClaudeSession;
  if (info.open) holdOpen(holder, info.split);
  useHosted(holder, found.attach(hostedHandlers(holder)));
  watchWindow(holder);
  void pump(holder, holder.stream[Symbol.asyncIterator]());
  return holder;
}
