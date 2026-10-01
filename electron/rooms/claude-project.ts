import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import { findExecutable } from "../executables";
import { ClaudeSignedOutError } from "./claude-sign-in";
import type { AgentOptions } from "../agents/types";
import { claudeActivity, claudeEditedPaths } from "./activity";
import { answeredFindings, reportedFindings } from "../../shared/deep-review";
import type {
  AgentActivity,
  ContextUsage,
  PromptCache,
} from "../../shared/projects";
import {
  closeSession,
  newSession,
  retune,
  sessions,
  setOptions,
  startSession,
} from "./claude-project/session";
import {
  adopt,
  release,
  settled,
  type ClaudeFrames,
  type ClaudeTurn,
} from "./claude-project/stream";
import {
  sessionConfig,
  sessionSignature,
  type ClaudeRunOptions,
} from "./claude-project/config";

export { sdk } from "./claude-project/sdk";
export { onClaudePending, wakeupTime } from "./claude-project/pending";
export type { ClaudeRunOptions } from "./claude-project/config";
export {
  closeClaudeSession,
  reattachClaudeSessions,
} from "./claude-project/session";
export {
  claudeAgentRun,
  claudeAgents,
  claudePending,
  stopClaudeAgent,
  stopClaudeTask,
} from "./claude-project/live";
export { readClaudeUsage } from "./claude-project/usage";
export { askClaudeSide, type SideExchange } from "./claude-project/side";
export {
  claudeDefaults,
  listClaudeCommands,
  listClaudeModels,
} from "./claude-project/catalog";

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
    turn = adopt(session);
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
      const holder = newSession(options, signature, controller);
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
