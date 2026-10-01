import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type {
  EffortLevel,
  ModelUsage,
  Options,
  SDKControlGetUsageResponse,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { findExecutable } from "../executables";
import { ClaudeSignedOutError } from "./claude-sign-in";
import type { AgentOptions } from "../agents/types";
import { claudeActivity, claudeEditedPaths } from "./activity";
import { SubagentTracker } from "./claude-agents";
import type { SubagentDetail, SubagentRun } from "../../shared/subagents";
import { answeredFindings, reportedFindings } from "../../shared/deep-review";
import type {
  AgentActivity,
  ChatPending,
  ContextUsage,
  PromptCache,
} from "../../shared/projects";
import { withTimeout } from "../timeout";
import { settingsEffort } from "../../shared/agent-defaults";
import type { FoundSession, HostedQuery } from "../agent-host/client";
import type { HookFrame } from "../agent-host/protocol";
import { AsyncQueue } from "../async-queue";
import { HostedSessions, inAgentHost } from "../agents/hosted-sessions";
import {
  readSettings,
  sdk,
  withProbe,
  type ClaudeInput,
  type ClaudeStream,
  type SDKMessage,
} from "./claude-project/sdk";
import { ClaudeWork, pendingChanged } from "./claude-project/pending";
import { hostedHandlers, sessionCallbacks } from "./claude-project/requests";
import {
  claudePermissionMode,
  sessionConfig,
  sessionSignature,
  type ClaudeRunOptions,
} from "./claude-project/config";

export { sdk } from "./claude-project/sdk";
export { onClaudePending, wakeupTime } from "./claude-project/pending";
export type { ClaudeRunOptions } from "./claude-project/config";
export {
  claudeDefaults,
  listClaudeCommands,
  listClaudeModels,
} from "./claude-project/catalog";

/** Frames read off the stream, waiting for the turn they belong to. */
class ClaudeFrames extends AsyncQueue<SDKMessage> {
  /** Why the stream ended early, when it failed rather than closed. */
  failure?: string;
  end(failure?: unknown) {
    if (failure)
      this.failure =
        failure instanceof Error ? failure.message : String(failure);
    super.end();
  }
}
/**
 * A turn in flight. Claude starts unprompted ones itself, e.g. when a
 * background task ends; `from` is where one began in the host's log.
 */
type ClaudeTurn = { unprompted: boolean; adopted?: boolean; from?: number };
/** What a hosted session keeps with it, to be picked up again after a restart. */
type HostedMeta = {
  signature: string;
  skipsPermissions: boolean;
  options: Pick<
    ClaudeRunOptions,
    | "cwd"
    | "model"
    | "effort"
    | "contextWindow"
    | "runtimeMode"
    | "interactionMode"
    | "readOnly"
    | "choice"
  >;
};
type ClaudeSession = {
  options: ClaudeRunOptions;
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
const sessions = new HostedSessions<ClaudeSession>({
  provider: "claude",
  name: "Claude",
  kind: "claude",
  close: closeSession,
});
function closeSession(session: ClaudeSession) {
  session.input.close();
  session.stream.close();
  session.released?.();
}
/** The session's options are a turn's own again. */
function setOptions(session: ClaudeSession, options: ClaudeRunOptions) {
  session.options = options;
  session.ready?.resolve();
  session.ready = undefined;
}
/**
 * Moves a live session to new settings instead of restarting it, which
 * would end the background work and wake-ups it holds. False when it can't:
 * another folder, or full access for a session launched without it.
 */
async function retune(session: ClaudeSession, options: ClaudeRunOptions) {
  const before = session.options;
  const mode = claudePermissionMode(options);
  if (
    options.cwd !== before.cwd ||
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
/** Reads the stream for the session's lifetime, not only while a turn is waiting. */
async function pump(
  session: ClaudeSession,
  iterator: AsyncIterator<SDKMessage>,
) {
  let failure: unknown;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      // Here rather than in receive(): frames a turn leaves unread pass through that twice.
      session.agents.observe(next.value);
      // Replayed after a restart, turns already shown only rebuild what's running.
      const seq = session.hosted?.seqOf(next.value);
      if (seq !== undefined && seq < session.hosted!.split)
        restore(session, next.value);
      else receive(session, next.value);
    }
  } catch (error) {
    // The turn reading the frames reports the stop.
    failure = error;
  } finally {
    session.agents.close();
    session.frames.end(failure);
    pendingChanged();
  }
}
function restore(session: ClaudeSession, message: SDKMessage) {
  const hook = message as unknown as HookFrame;
  if (hook.type === "relay_hook") {
    if (hook.event === "Stop") session.work.schedule(hook.input);
  } else if (
    message.type === "system" &&
    message.subtype === "background_tasks_changed"
  )
    session.work.track(message.tasks);
}
function receive(session: ClaudeSession, message: SDKMessage) {
  // The host logs the end-of-turn hook as a frame of its own.
  if ((message as unknown as HookFrame).type === "relay_hook")
    return restore(session, message);
  if (
    message.type === "system" &&
    message.subtype === "background_tasks_changed"
  )
    session.work.track(message.tasks);
  if (session.turn) return session.frames.push(message);
  // Between turns, only Claude's own output matters. Init, status and late
  // results have nothing to show, and subagents report through their parent.
  const output =
    (message.type === "stream_event" || message.type === "assistant") &&
    !message.parent_tool_use_id;
  if (!output) return;
  const turn: ClaudeTurn = {
    unprompted: true,
    from: session.hosted?.seqOf(message),
  };
  session.turn = turn;
  session.frames.push(message);
  const show = session.options.session?.onUnprompted;
  const done = Promise.resolve()
    .then(() => show?.())
    .catch(() => {})
    // Nobody showed it: read it to the end so the next prompt starts clean.
    .then(async () => {
      if (session.turn !== turn || turn.adopted) return;
      let frame: SDKMessage | undefined;
      while ((frame = await session.frames.next()) && frame.type !== "result");
      const seq = frame && session.hosted?.seqOf(frame);
      session.hosted?.mark("end", seq === undefined ? undefined : seq + 1);
      release(session);
    })
    .finally(() => {
      if (session.unprompted === done) session.unprompted = undefined;
    });
  session.unprompted = done;
}
/** What Claude left running that will start its next turn, while its session lives. */
export function claudePending(key: string): ChatPending[] {
  const session = sessions.get(key);
  if (!session || session.frames.ended) return [];
  return session.work.list();
}
/** Stops a background task; Claude hears it stopped and usually says so. */
export async function stopClaudeTask(key: string, taskId: string) {
  const session = sessions.get(key);
  if (!session?.work.has(taskId) || session.frames.ended)
    throw new Error("That work has already finished.");
  await session.stream.stopTask(taskId);
}
/** The subagents a thread's live session started, running or back. */
export function claudeAgents(key: string): SubagentRun[] {
  return sessions.get(key)?.agents.list() ?? [];
}
export function claudeAgentRun(
  key: string,
  id: string,
): SubagentDetail | undefined {
  return sessions.get(key)?.agents.detail(id);
}
/** Stops one agent, foreground or background; Claude hears it was stopped. */
export async function stopClaudeAgent(key: string, id: string) {
  const session = sessions.get(key);
  const taskId = session?.agents.taskId(id);
  if (!session || !taskId || session.frames.ended)
    throw new Error("That agent has already finished.");
  await session.stream.stopTask(taskId);
}
/** Ends the current turn. Frames it didn't consume belong to whatever Claude does next. */
function release(session: ClaudeSession) {
  session.turn = undefined;
  session.released?.();
  session.released = undefined;
  for (const frame of session.frames.take()) receive(session, frame);
}
function settled(done: Promise<void>, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const stop = () => reject(new Error("Cancelled by you."));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    void done.finally(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    });
  });
}
/**
 * The data behind Claude Code's /usage, fetched by the CLI with its own
 * sign-in; Relay never handles the token. Null when the CLI is signed out.
 * A running session answers without starting another process.
 */
export async function readClaudeUsage(): Promise<SDKControlGetUsageResponse | null> {
  const live = [...sessions.values()].at(-1);
  if (live) {
    try {
      const usage = await usageFrom(live.stream, 5000);
      // Sessions left running for hours stop reporting the plan's limits.
      if (!usage || usage.rate_limits_available) return usage;
    } catch {
      // Closing or stuck behind its turn; a fresh probe still answers.
    }
  }
  return withProbe({ settingSources: ["user"] }, (stream) =>
    usageFrom(stream, 20000),
  );
}
async function usageFrom(stream: ClaudeStream, ms: number) {
  const ask = async () => {
    const account = await stream.accountInfo();
    if (account?.tokenSource === "none" && !account.apiKeySource) return null;
    // Experimental in the SDK; when it's renamed, this stops type-checking.
    return stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    });
  };
  return withTimeout(ask(), ms, "Claude did not report usage.");
}
export function closeClaudeSession(key: string) {
  const session = sessions.get(key);
  sessions.delete(key);
  if (session) closeSession(session);
}
/** An earlier question in a side thread, and what Claude said to it. */
export type SideExchange = { question: string; response: string };
type SideAsking = ClaudeStream & {
  askSideQuestion(
    question: string,
    options?: { history?: SideExchange[]; signal?: AbortSignal },
  ): Promise<{ response: string } | null>;
};
/**
 * Claude Code's `/btw`: one answer from the session's context, with no tools,
 * that never enters its transcript. A live session answers even mid-turn;
 * otherwise the saved one is resumed just for this. `history` is the side
 * thread so far; the SDK doesn't type `askSideQuestion` yet.
 */
export async function askClaudeSide(options: {
  key: string;
  thread: string;
  cwd: string;
  model: string;
  question: string;
  history: SideExchange[];
  signal: AbortSignal;
}): Promise<string> {
  const ask = async (stream: ClaudeStream) => {
    const answer = await (stream as SideAsking).askSideQuestion(
      options.question,
      { history: options.history, signal: options.signal },
    );
    if (!answer?.response.trim())
      throw new Error("Claude had no answer. Try again.");
    return answer.response;
  };
  const live = sessions.get(options.key);
  if (live && !live.frames.ended) return ask(live.stream);
  const [{ query }, executable] = await Promise.all([
    sdk(),
    findExecutable("claude"),
  ]);
  options.signal.throwIfAborted();
  // No prompt ever goes in: the session only loads to answer beside it.
  const input: ClaudeInput = new AsyncQueue();
  const stream = query({
    prompt: input,
    options: {
      cwd: options.cwd,
      pathToClaudeCodeExecutable: executable,
      resume: options.thread,
      persistSession: false,
      settingSources: ["user", "project", "local"],
      strictMcpConfig: true,
      mcpServers: {},
      ...(options.model ? { model: options.model } : {}),
    },
  });
  void (async () => {
    for await (const _ of stream);
  })().catch(() => {});
  try {
    return await ask(stream);
  } finally {
    input.close();
    stream.close();
  }
}
/** Starts the session's Claude Code, in the agent host when there is one. */
async function startSession(
  holder: ClaudeSession,
  config: Options,
  key?: string,
) {
  const hosted = await openHosted(holder, config, key);
  if (hosted) useHosted(holder, hosted);
  else {
    const { promptSubmit, canUseTool } = sessionCallbacks(holder);
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
        },
        canUseTool,
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
    const meta = found.info.meta as HostedMeta | undefined;
    return meta?.options
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
    frames: new ClaudeFrames(),
    controller: new AbortController(),
    plan: "",
    busy: false,
    work: new ClaudeWork(),
    agents: new SubagentTracker(),
    threadId: info.threadId,
    ready: { promise, resolve },
    // A turn cut off by the restart is waiting to be shown.
    ...(info.open ? { turn: { unprompted: true, from: info.split } } : {}),
  } as unknown as ClaudeSession;
  if (info.open) {
    // A prompt sent meanwhile waits for it, as for any turn Claude began itself.
    const done: Promise<void> = new Promise<void>(
      (r) => (holder.released = r),
    ).finally(() => {
      if (holder.unprompted === done) holder.unprompted = undefined;
    });
    holder.unprompted = done;
  }
  useHosted(holder, found.attach(hostedHandlers(holder)));
  watchWindow(holder);
  void pump(holder, holder.stream[Symbol.asyncIterator]());
  return holder;
}
export async function runClaudeProject(
  options: ClaudeRunOptions,
): Promise<string> {
  const executable = await findExecutable("claude");
  options.signal.throwIfAborted();
  const key = options.session?.key;
  const signature = sessionSignature(options);
  let session = key ? sessions.get(key) : undefined;
  let turn: ClaudeTurn;
  if (options.adopt) {
    if (!session?.turn?.unprompted || session.turn.adopted)
      throw new Error("Claude has no turn of its own to show.");
    turn = session.turn;
    turn.adopted = true;
  } else {
    // A turn Claude started itself finishes first, so neither answer lands under the other.
    while (session?.unprompted) {
      await settled(session.unprompted, options.signal);
      session = key ? sessions.get(key) : undefined;
    }
    if (session?.busy)
      throw new Error("This Claude session is already running a turn.");
    // New settings mean a new session, unless Claude still has work running
    // in this one that a restart would end.
    const working = !!session && session.work.any;
    if (
      session &&
      !session.frames.ended &&
      session.signature !== signature &&
      working &&
      (await retune(session, options))
    )
      session.signature = signature;
    if (session && (session.signature !== signature || session.frames.ended)) {
      closeSession(session);
      sessions.delete(key!);
      session = undefined;
    }
    turn = { unprompted: false };
  }
  let answer = "",
    currentText = "",
    currentMessage = "",
    succeeded = false,
    // Earlier answers in this turn, when a late steer ran as a follow-up turn.
    before = "",
    steerable = true;
  // Steers Claude hasn't finished with, by the uuid sent with them. Claude
  // reports each one's progress; `state` stays unset on CLIs that don't.
  const steering = new Map<string, { id?: string; state?: string }>();
  // The prompt's own progress, on CLIs that report it.
  const prompt: { uuid: ReturnType<typeof randomUUID>; state?: string } = {
    uuid: randomUUID(),
  };
  // Text followed by a tool call is commentary, not the answer. Keep it out of the body.
  const commentary = new Set<string>();
  // A tool result only carries the call id; keep the call's label for the finished row.
  const toolCalls = new Map<string, AgentActivity>();
  // A subagent's latest summary, by its call; reports between them omit it.
  const summaries = new Map<string, string>();
  // Findings `/code-review` reported to its tool rather than in its answer.
  let reported: string | undefined;
  // Past the last frame this turn read from the host's log.
  let consumed: number | undefined;
  const publish = (text: string) => {
    if (text.length > 100000) throw new Error("Answer size limit reached.");
    answer = text;
    options.onText(before + text);
  };
  const controller = session?.controller ?? new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  try {
    if (!session) {
      // SDK callbacks outlive a turn. Resolve them against the current local request broker.
      const holder = {
        options,
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
      } as ClaudeSession;
      const config = sessionConfig(
        options,
        executable,
        holder.skipsPermissions,
      );
      holder.turn = turn;
      await startSession(holder, config, key);
      session = holder;
      if (key) sessions.set(key, session);
    }
    setOptions(session, options);
    // The host's log marks the turn, so a restart knows what to show again.
    if (options.adopt) session.hosted?.mark("start", turn.from);
    session.plan = "";
    session.busy = true;
    const imageBlocks = (images: AgentOptions["images"]) =>
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
    const images = await imageBlocks(options.images);
    options.signal.throwIfAborted();
    if (options.compact && !session.threadId && !options.session?.id)
      throw new Error("There is no Claude session to compact yet.");
    if (!options.adopt) {
      // Claim the stream as the prompt goes out; a turn Claude began meanwhile finishes first.
      while (session.unprompted)
        await settled(session.unprompted, options.signal);
      session.turn = turn;
      session.hosted?.mark("start");
      session.input.push({
        type: "user",
        uuid: prompt.uuid,
        session_id: session.threadId ?? "",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: options.compact
            ? `/compact ${options.prompt}`.trim()
            : [
                // A screenshot sent alone has no text; the API refuses an empty block.
                ...(options.prompt
                  ? [{ type: "text" as const, text: options.prompt }]
                  : []),
                ...images,
              ],
        },
      });
    }
    if (!options.compact)
      options.onControl?.({
        steer: async (text, id, steerImages) => {
          if (!steerable || options.signal.aborted)
            throw new Error(
              "This turn has finished. Send the queued message as a new turn.",
            );
          const attached = await imageBlocks(steerImages);
          const uuid = randomUUID();
          steering.set(uuid, { id });
          // "next" folds the message into the running turn at its next step.
          session!.input.push({
            type: "user",
            uuid,
            session_id: session!.threadId ?? "",
            parent_tool_use_id: null,
            message: {
              role: "user",
              content: attached.length
                ? [
                    ...(text ? [{ type: "text" as const, text }] : []),
                    ...attached,
                  ]
                : text,
            },
            priority: "next",
          });
        },
      });
    let context: ContextUsage | undefined;
    // The CLI can end a turn it couldn't authenticate as a plain error result.
    let signedOut = false;
    let cache: PromptCache | undefined;
    // After a compact boundary, the next synthetic user message is the summary.
    let compacted: string | undefined;
    // The cache is read when a request starts, not when its reply arrives.
    let request: { id: string; at: number } | undefined;
    const report = (usedTokens: number) => {
      if (!(usedTokens > 0)) return;
      context = {
        usedTokens,
        ...(session!.contextWindow
          ? { maxTokens: session!.contextWindow }
          : {}),
        ...(cache ? { cache } : {}),
      };
      options.onContext?.(context);
    };
    while (true) {
      const message = await session.frames.next();
      const seq = message && session.hosted?.seqOf(message);
      if (seq !== undefined) consumed = seq + 1;
      if (!message)
        throw new Error(
          session.frames.failure
            ? `Claude stopped before completing this turn: ${session.frames.failure.slice(0, 500)}`
            : "Claude stopped before completing this turn.",
        );
      if (
        "session_id" in message &&
        message.session_id &&
        message.session_id !== session.threadId
      ) {
        session.threadId = message.session_id;
        await options.session?.onId(message.session_id);
      }
      // Not in the SDK's types: queued input reports queued, started, completed.
      const lifecycle = message as {
        type: string;
        command_uuid?: string;
        state?: string;
      };
      const steer =
        lifecycle.type === "command_lifecycle"
          ? steering.get(lifecycle.command_uuid ?? "")
          : undefined;
      if (steer) {
        steer.state = lifecycle.state;
        if (lifecycle.state === "started") {
          // Claude read the message; what follows answers it, below it.
          before = answer = "";
          steerable = true;
          if (steer.id) options.onSteered?.(steer.id);
        } else if (lifecycle.state !== "queued")
          steering.delete(lifecycle.command_uuid!);
      }
      if (
        lifecycle.type === "command_lifecycle" &&
        lifecycle.command_uuid === prompt.uuid
      ) {
        prompt.state = lifecycle.state;
        // Text before Claude picked the prompt up answered something else.
        if (prompt.state === "started" && answer) publish("");
      }
      if (message.type === "stream_event" && !message.parent_tool_use_id) {
        const event = message.event;
        if (event.type === "message_start") {
          currentText = "";
          currentMessage = event.message.id;
          request = { id: event.message.id, at: Date.now() };
        }
        if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use" &&
          currentText.trim()
        ) {
          commentary.add(currentMessage);
          options.onCommentary?.(currentMessage, currentText);
          currentText = "";
          publish("");
        }
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          currentText += event.delta.text;
          publish(currentText);
        }
      }
      if (message.type === "system" && message.subtype === "compact_boundary") {
        // The summary replaces the conversation the cache held.
        cache = undefined;
        report(message.compact_metadata.post_tokens ?? 0);
        compacted = "";
      }
      if (
        compacted === "" &&
        message.type === "user" &&
        message.isSynthetic &&
        !message.parent_tool_use_id
      ) {
        const content = message.message.content;
        compacted =
          typeof content === "string"
            ? content
            : content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
      }
      if (message.type === "assistant") {
        if (message.error === "authentication_failed") signedOut = true;
        if (!message.parent_tool_use_id) {
          // The newest entry of the main conversation is where a fork continues.
          options.session?.onPoint?.(message.uuid);
          const usage = message.message.usage;
          session.cacheTtl = claudeCacheTtl(usage, session.cacheTtl);
          if (session.cacheTtl)
            cache = {
              at: request?.id === message.message.id ? request.at : Date.now(),
              ttlMs: session.cacheTtl,
            };
          report(claudeContextTokens(usage));
        }
        const text = message.message.content
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        const tools = message.message.content.filter(
          (p) => p.type === "tool_use",
        );
        if (tools.length && text && !message.parent_tool_use_id) {
          commentary.add(message.message.id);
          options.onCommentary?.(message.message.id, text);
        }
        for (const tool of tools) {
          if (tool.name === "ReportFindings" && !message.parent_tool_use_id)
            reported = reportedFindings(tool.input) ?? reported;
          const activity = claudeActivity(tool.id, tool.name, tool.input);
          // A subagent's calls fold under the agent call that started it.
          if (message.parent_tool_use_id)
            activity.parentId = message.parent_tool_use_id.slice(0, 180);
          toolCalls.set(tool.id, activity);
          options.onActivity?.(activity);
          const edited = claudeEditedPaths(tool.name, tool.input);
          if (edited.length) options.onEdit?.(edited);
        }
        if (
          text &&
          !tools.length &&
          !message.parent_tool_use_id &&
          !commentary.has(message.message.id)
        )
          publish(text);
      }
      if (message.type === "user" && Array.isArray(message.message.content)) {
        for (const result of message.message.content)
          if (result.type === "tool_result") {
            const call = toolCalls.get(result.tool_use_id);
            const output =
              typeof result.content === "string"
                ? result.content
                : Array.isArray(result.content)
                  ? result.content
                      .flatMap((part) =>
                        part.type === "text" ? [part.text] : [],
                      )
                      .join("\n")
                  : "";
            const finished: AgentActivity = {
              ...(call ?? claudeActivity(result.tool_use_id, "Tool", {})),
              progress: undefined,
              ...(!call && message.parent_tool_use_id
                ? { parentId: message.parent_tool_use_id.slice(0, 180) }
                : {}),
              status: result.is_error ? "failed" : "complete",
              ...(output ? { detail: output.slice(-8000) } : {}),
            };
            toolCalls.set(result.tool_use_id, finished);
            options.onActivity?.(finished);
          }
      }
      if (message.type === "system" && message.subtype === "task_progress") {
        // A running subagent's row says what it is doing now.
        const call = toolCalls.get(message.tool_use_id ?? "");
        if (call?.kind === "agent" && call.status === "running") {
          const summary = message.summary?.trim();
          if (summary) summaries.set(call.id, summary);
          const doing =
            summaries.get(call.id) ||
            (message.last_tool_name && `Using ${message.last_tool_name}`);
          const uses = message.usage.tool_uses;
          const progress = [
            doing,
            uses && `${uses} tool${uses === 1 ? "" : "s"}`,
          ]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 300);
          if (progress && progress !== call.progress) {
            const updated = { ...call, progress };
            toolCalls.set(updated.id, updated);
            options.onActivity?.(updated);
          }
        }
      }
      if (message.type === "result") {
        // Claude finishes what it queued before the prompt first: resuming a
        // session reports a background command the last process left running
        // with a result of its own, sometimes before the prompt is even queued.
        const origin = (message as { origin?: { kind?: string } }).origin;
        if (
          !options.adopt &&
          (prompt.state === "queued" ||
            (prompt.state !== "started" && origin && origin.kind !== "human"))
        )
          continue;
        steerable = false;
        if (message.is_error || message.subtype !== "success")
          throw signedOut
            ? new ClaudeSignedOutError()
            : new Error("Claude could not complete this turn.");
        const windows = Object.values(message.modelUsage ?? {})
          .map((usage) => usage.contextWindow)
          .filter((size) => size > 0);
        if (windows.length) {
          session.contextWindow = Math.max(...windows);
          if (context) report(context.usedTokens);
        }
        const total = claudeSessionTokens(message.modelUsage);
        if (context && total) {
          context = { ...context, totalTokens: total };
          options.onContext?.(context);
        }
        if (options.compact) {
          succeeded = true;
          return compacted ?? "";
        }
        const final = session.plan || message.result || answer;
        const written = session.plan ? undefined : answeredFindings(final);
        publish(
          written ??
            (reported && !session.plan
              ? [final, reported].filter((part) => part.trim()).join("\n\n")
              : final),
        );
        // A turn Claude started itself may only have run tools.
        if (!answer.trim() && !options.adopt)
          throw new Error("Claude returned an empty answer.");
        const steers = [...steering.values()];
        // A steer Claude didn't get to runs as its own turn right after this one.
        if (steers.some((s) => s.state === "queued")) continue;
        if (steers.some((s) => !s.state)) {
          steering.clear();
          if (await startsFollowUp(session.frames)) {
            before += answer + "\n\n";
            answer = "";
            steerable = true;
            continue;
          }
        }
        succeeded = true;
        return before + answer;
      }
    }
  } finally {
    options.signal.removeEventListener("abort", abort);
    if (session) {
      session.busy = false;
      if (!key || !succeeded || options.signal.aborted) {
        closeSession(session);
        if (key) sessions.delete(key);
      } else if (session.turn === turn) {
        session.hosted?.mark("end", consumed);
        release(session);
      }
    }
  }
}

/**
 * For CLIs that don't report steering progress: a steer that arrives after
 * Claude's last step can't fold into the turn, so Claude runs it as its own
 * turn right after the result. That turn opens with an init frame at once; a
 * quiet stream means every steer was folded in. Anything else is left for
 * whatever Claude does next.
 */
async function startsFollowUp(frames: ClaudeFrames) {
  if (!(await frames.wait(2000))) return false;
  const first = frames.peek();
  return first?.type === "system" && first.subtype === "init";
}

const CACHE_5M = 5 * 60_000;
const CACHE_1H = 60 * 60_000;

/**
 * How long the conversation stays cached after this request: five minutes by
 * default, an hour when Claude Code asks for it. Requests that only read the
 * cache don't say, so they keep the lifetime the session already wrote with.
 */
export function claudeCacheTtl(
  usage: unknown,
  known?: number,
): number | undefined {
  if (!usage || typeof usage !== "object") return known;
  const u = usage as Record<string, any>;
  if (u.cache_creation?.ephemeral_1h_input_tokens > 0) return CACHE_1H;
  if (u.cache_creation?.ephemeral_5m_input_tokens > 0) return CACHE_5M;
  if (known) return known;
  if (u.cache_creation_input_tokens > 0 || u.cache_read_input_tokens > 0)
    return CACHE_5M;
}

/** Tokens the session processed so far, subagents and cache reads included. */
function claudeSessionTokens(modelUsage: Record<string, ModelUsage> = {}) {
  return Object.values(modelUsage).reduce(
    (sum, u) =>
      sum +
      u.inputTokens +
      u.outputTokens +
      u.cacheReadInputTokens +
      u.cacheCreationInputTokens,
    0,
  );
}

/** A request's prompt plus its reply is what the next request carries forward. */
export function claudeContextTokens(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  const count = (key: string) =>
    typeof u[key] === "number" && Number.isFinite(u[key])
      ? (u[key] as number)
      : 0;
  return (
    count("input_tokens") +
    count("cache_creation_input_tokens") +
    count("cache_read_input_tokens") +
    count("output_tokens")
  );
}
