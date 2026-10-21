import { readFile } from "node:fs/promises";
import { projectInstructions, sideInstructions } from "../instructions";
import { renderPrompt } from "../../../shared/html-render";
import { CodexPlanRows } from "../activity";
import { signedOutError, usageLimitError } from "../errors";
import {
  answerLimitError,
  CANCEL_GRACE_MS,
  cancelledByYou,
  guardSteer,
  TurnEnd,
  TurnText,
} from "../turn-kit";
import type { AgentOptions } from "../types";
import { museActivity, museEditedPaths, todoPlan } from "./activity";
import { MuseRequestError } from "./connection";
import {
  commandId,
  contextUsageSchema,
  isEffort,
  itemSchema,
  profiles,
  todoListSchema,
  tokenUsageNoticeSchema,
  turnCompletedSchema,
  type MuseItem,
  type MuseTokenUsage,
  type MuseTurnCompleted,
} from "./protocol";
import { MuseRequests } from "./requests";
import {
  acquireMuse,
  openSession,
  signedIn,
  type MuseMcpServer,
  type MuseSettings,
} from "./sessions";
import { MuseSubagents, museSubagentBooks } from "./subagents";
import { museUsageSeen } from "./usage";


const planInstructions =
  "Plan mode: investigate and reply with a plan for the request. Do not change any files or run commands that change anything.";

/** Relay's tools, for a thread's own turn; reviewers, side questions and helpers go without. */
const relayToolsOf = (options: AgentOptions) =>
  options.relayTools &&
  !options.readOnly &&
  options.job.kind !== "helper" &&
  options.job.kind !== "side"
    ? options.relayTools
    : undefined;

/** What Relay tells Muse once, at the head of a conversation; Muse has no system prompt to set. */
function instructions(options: AgentOptions) {
  const { job } = options;
  if (job.kind === "helper") return job.instructions;
  const tools = relayToolsOf(options);
  return [
    projectInstructions,
    job.kind === "side" && sideInstructions,
    tools && renderPrompt(tools.renders),
    options.readOnly &&
      "This is a read-only turn. Do the requested work yourself and return a final written answer, even if no findings hold up. You cannot delegate to subagents, edit files, or ask for permissions. Use separate read-only commands such as git diff and git show; read their output directly and narrow large diffs by path instead of writing temporary files. If a tool is blocked, use an allowed read-only tool and continue; if you cannot complete the task, explain the blocker in your final answer.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The thread's mode as Muse runs it: a permission profile and when to ask. */
export function museSettings(options: AgentOptions): MuseSettings {
  const model = options.choice.model || undefined;
  if (options.job.kind === "helper")
    return { profile: profiles.readOnly, approvalMode: "denyUnmatched", model };
  if (options.readOnly || options.job.kind === "side" || options.interactionMode === "plan")
    return {
      profile: profiles.readOnly,
      // Nobody to ask in a review or a side question; a plan may still ask to read.
      approvalMode: options.interactionMode === "plan" && !options.readOnly ? "promptUnmatched" : "denyUnmatched",
      model,
    };
  switch (options.runtimeMode ?? "approval-required") {
    case "full-access":
      return { profile: profiles.unrestricted, approvalMode: "allowAll", model };
    case "auto":
      return { profile: profiles.autoReview, approvalMode: "onRequest", model };
    case "auto-accept-edits":
      return { profile: profiles.askMe, approvalMode: "onRequest", model };
    default:
      return { profile: profiles.askMe, approvalMode: "promptUnmatched", model };
  }
}

/** Relay's own tools, as an MCP server the session reaches over HTTP. */
const mcpServers = (options: AgentOptions): Record<string, MuseMcpServer> => {
  const tools = relayToolsOf(options);
  return tools
    ? {
        relay: {
          transport: "streamableHttp",
          url: tools.url,
          headers: { Authorization: `Bearer ${tools.token}` },
          mode: "optional",
        },
      }
    : {};
};

/** A turn's input: text, images and the skill a leading `/name` picks. */
async function inputOf(text: string, options: AgentOptions, steerImages?: AgentOptions["images"]) {
  const parts: object[] = [];
  const skill = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (skill && options.job.kind === "prompt")
    parts.push({ type: "skill", selector: skill[1], ...(skill[2]?.trim() && { arguments: skill[2].trim() }) });
  else if (text) parts.push({ type: "text", text });
  for (const image of steerImages ?? options.images ?? [])
    parts.push({
      type: "image",
      mediaType: image.mimeType,
      base64Data: (await readFile(image.path)).toString("base64"),
    });
  return parts;
}

/** Muse's token counts as Relay's: input left after the cache. */
function tokensOf(usage: MuseTokenUsage) {
  const cacheRead = usage.cacheReadTokens ?? usage.cachedTokens;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  return {
    input: Math.max(0, usage.inputTokens - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: usage.outputTokens,
  };
}

/** Why a turn failed, as the thread can act on it. */
function failure(done: MuseTurnCompleted): Error {
  const error = done.error;
  if (done.terminal === "cancelled") return new Error("Cancelled by you.");
  if (error?.kind === "authRequired") return signedOutError("muse");
  if (error?.quota)
    return usageLimitError("muse", error.message || "Muse Code's usage limit was reached.", error.quota.resetsAtMs);
  return new Error(
    error?.message ? `Muse Code: ${error.message}` : `Muse Code didn't finish this answer${done.reason ? ` (${done.reason})` : ""}.`,
  );
}

/** Runs one turn on Muse Code, starting or picking up the thread's session in its own `muse serve`. */
export async function runMuse(options: AgentOptions): Promise<string> {
  const { signal, job } = options;
  signal.throwIfAborted();
  if (job.kind === "review") throw new Error("Muse Code has no /review of its own.");
  if (job.kind === "goal") throw new Error("Relay doesn't run Muse Code's /goal yet.");

  const helper = job.kind === "helper";
  // A helper job is one bare question in a process of its own, never the thread's.
  const key = helper ? undefined : options.session?.key;
  const agent = await acquireMuse(key, options.cwd, options.env, helper);
  const { connection } = agent;
  const adopted = job.kind === "adopt" ? agent.inflight : undefined;
  if (job.kind === "adopt" && (!adopted || !agent.session)) {
    agent.settle(!!key);
    throw new Error("There is no Muse Code turn to pick up.");
  }

  let sessionId = agent.session?.id;
  let turnId = adopted?.turnId;
  const turn = new TurnText(options.onText, options.onCommentary, "muse");
  const turnAbort = new AbortController();
  const requests = new MuseRequests(connection, options, turnAbort.signal);
  const subagents = new MuseSubagents(
    connection,
    () => sessionId,
    (activity) => options.onActivity?.(activity),
    key ? museSubagentBooks.open(key) : undefined,
  );
  const plans = new CodexPlanRows();
  /** Each answer item's text so far, so a completed item adds only what its deltas missed. */
  const said = new Map<string, number>();
  /** Steering sent, by the command id Muse echoes on the message it reads. */
  const steers = new Map<string, string>();
  let compaction: MuseItem | undefined;

  const ended = new TurnEnd<MuseTurnCompleted | "compacted">();
  const complete = (done: MuseTurnCompleted | "compacted") => ended.succeed(done);
  const fail = (error: Error) => ended.fail(error);

  /** The answer item text last went to; another one after it is a new paragraph. */
  let speaking: string | undefined;
  const addText = (itemId: string, text: string) => {
    if (!text) return;
    said.set(itemId, (said.get(itemId) ?? 0) + text.length);
    if (speaking && speaking !== itemId) turn.add("\n\n");
    speaking = itemId;
    turn.add(text);
    const over = answerLimitError(turn.size);
    if (over) {
      fail(over);
      interrupt();
    }
  };

  const ours = (item: MuseItem) => !turnId || !item.turnId || item.turnId === turnId;

  const hearItem = (method: string, item: MuseItem) => {
    if (!ours(item)) return;
    if (item.kind === "userMessage") {
      const steer = item.commandId && steers.get(item.commandId);
      if (item.steered && steer) {
        turn.reset();
        speaking = undefined;
        options.onSteered?.(steer);
      }
      return;
    }
    if (item.kind === "agentMessage") {
      if (method === "item/completed" && item.text)
        addText(item.itemId, item.text.slice(said.get(item.itemId) ?? 0));
      return;
    }
    if (item.kind === "toolCall" && method === "item/started") {
      turn.toCommentary();
      speaking = undefined;
      const paths = museEditedPaths(item);
      if (paths.length) options.onEdit?.(paths);
    }
    if (item.kind === "subagent") {
      turn.toCommentary();
      speaking = undefined;
      subagents.item(item);
    }
    if (item.kind === "compaction") {
      compaction = item;
      // A /compact shows as its own line in the thread, not inside a turn.
      if (job.kind === "compact") {
        if (item.status !== "inProgress") complete("compacted");
        return;
      }
    }
    const activity = museActivity(item);
    if (activity) options.onActivity?.(activity);
  };

  connection.onNotification = (method, params) => {
    if (subagents.notification(method, params)) return;
    const p = (params ?? {}) as Record<string, unknown>;
    if (sessionId && p.sessionId !== undefined && p.sessionId !== sessionId) return;
    if (requests.notification(method, params)) return;
    switch (method) {
      case "item/started":
      case "item/updated":
      case "item/completed": {
        const item = itemSchema.safeParse(p.item);
        if (item.success) hearItem(method, item.data);
        return;
      }
      case "item/delta": {
        const id = typeof p.itemId === "string" ? p.itemId : "";
        const field = typeof p.field === "string" ? p.field : "text";
        // Only answer text streams in; tool output shows once a call ends.
        if (field === "text" && typeof p.delta === "string") addText(id, p.delta);
        return;
      }
      case "session/tokenUsage": {
        const usage = tokenUsageNoticeSchema.safeParse(params);
        if (usage.success && (!turnId || !usage.data.turnId || usage.data.turnId === turnId))
          options.onUsage?.({
            model: usage.data.modelId || options.choice.model || "muse",
            tokens: tokensOf(usage.data.usage),
          });
        return;
      }
      case "session/contextUsage": {
        const usage = contextUsageSchema.safeParse(params);
        if (usage.success)
          options.onContext?.({
            usedTokens: usage.data.usedTokens,
            ...(usage.data.windowTokens && { maxTokens: usage.data.windowTokens }),
          });
        return;
      }
      case "session/todoListChanged": {
        const todos = todoListSchema.safeParse(params);
        const row = todos.success && sessionId ? plans.update(sessionId, todoPlan(todos.data.items)) : undefined;
        if (row) options.onActivity?.(row);
        return;
      }
      case "session/nameChanged":
        if (typeof p.name === "string" && p.name.trim()) options.onTitle?.(p.name.trim());
        return;
      case "usage/changed":
        museUsageSeen(params);
        return;
      case "turn/retryScheduled":
        if (p.turnId === turnId)
          options.onCommentary?.(
            "muse-retry",
            `Muse Code is retrying (attempt ${String(p.nextAttempt ?? "")} of ${String(p.maxAttempts ?? "")})${typeof p.reason === "string" && p.reason ? `: ${p.reason}` : ""}.`,
          );
        return;
      case "turn/started":
        if (p.turnId === turnId) options.onCommentary?.("muse-retry", null);
        return;
      case "turn/completed": {
        const done = turnCompletedSchema.safeParse(params);
        if (!done.success || done.data.turnId !== turnId) return;
        return complete(done.data);
      }
      case "session/closed":
        fail(new Error("Muse Code closed the session."));
        return;
    }
  };
  connection.onClose = (reason) => fail(new Error(connection.log ? `${reason}\n\n${connection.log.slice(-2000)}` : reason));

  const steerable = () =>
    options.onControl?.({
      steer: (text, id, images) =>
        guardSteer(
          () => !turnAbort.signal.aborted && !!turnId,
          () => inputOf(text, options, images ?? []),
          async (steerInput) => {
            const steer = commandId();
            if (id) steers.set(steer, id);
            await connection.request("turn/steer", {
              commandId: steer,
              sessionId,
              expectedTurnId: turnId,
              input: steerInput,
            });
          },
        ),
    });

  let cancelTimer: NodeJS.Timeout | undefined;
  const interrupt = () => {
    if (turnAbort.signal.aborted) return;
    turnAbort.abort();
    if (sessionId && turnId)
      void connection
        .request("turn/interrupt", { commandId: commandId(), sessionId, turnId })
        .catch(() => {});
    cancelTimer = setTimeout(() => fail(cancelledByYou()), CANCEL_GRACE_MS);
    cancelTimer.unref?.();
  };
  signal.addEventListener("abort", interrupt, { once: true });

  try {
    connection.mark("start");
    if (adopted) {
      steerable();
      // What it said while Relay was away comes now, with a listener in place.
      connection.resume();
    } else {
      const opened = await openSession(agent, {
        id: helper ? undefined : options.session?.id,
        fork: options.session?.id ? undefined : options.session?.fork,
        cwd: options.cwd,
        roots: (options.links ?? []).filter((link) => link.access === "write").map((link) => link.path),
        mcpServers: mcpServers(options),
        settings: museSettings(options),
      });
      sessionId = opened.id;
      if (key && opened.id !== options.session?.id) await options.session?.onId(opened.id);
      if (opened.lost)
        options.onCommentary?.(
          "muse-lost",
          "Muse Code couldn't open the earlier conversation, so this turn starts a new one.",
        );
      signal.throwIfAborted();
      if (job.kind === "compact") {
        const result = (await connection.request("session/compact", {
          commandId: commandId(),
          sessionId,
        })) as { status?: string; reason?: string };
        if (result.status === "noop") return "There was nothing to compact yet.";
      } else {
        // A new conversation hears Relay's instructions with its first prompt.
        const fresh = !options.session?.id || opened.lost;
        const note = helper ? undefined : await options.context?.().catch(() => undefined);
        const head = [fresh || helper ? instructions(options) : undefined, options.interactionMode === "plan" && planInstructions, note]
          .filter(Boolean)
          .join("\n\n");
        const input = await inputOf(options.prompt, options);
        // Muse joins text parts with nothing between them.
        if (head) input.unshift({ type: "text", text: `${head}\n\n` });
        signal.throwIfAborted();
        const command = commandId();
        // A fresh turn's id is the command that started it.
        turnId = command;
        agent.inflight = { turnId };
        agent.keep();
        const effort = options.choice.reasoningEffort;
        const started = (await signedIn(() =>
          connection.request("turn/start", {
            commandId: command,
            sessionId,
            input,
            // The transcript shows the user's own words, not what Relay put around them.
            displayText: (options.request ?? options.prompt).slice(0, 20_000),
            ...(isEffort(effort) && { reasoningEffort: effort }),
          }),
        )) as { turnId?: string };
        if (started.turnId && started.turnId !== turnId) {
          turnId = started.turnId;
          agent.inflight = { turnId };
          agent.keep();
        }
        steerable();
      }
    }
    if (signal.aborted) interrupt();
    const done = await ended.promise;
    if (done === "compacted") {
      const c = compaction;
      return c?.tokensBefore && c.tokensAfter
        ? `Compacted the conversation from ${c.tokensBefore.toLocaleString("en")} to ${c.tokensAfter.toLocaleString("en")} tokens.`
        : "Compacted the conversation.";
    }
    if (done.terminal !== "completed") throw failure(done);
    if (job.kind === "compact") return "Compacted the conversation.";
    if (turnId) options.session?.onPoint?.(turnId);
    const answer = turn.answer();
    if (options.interactionMode === "plan" && answer.trim()) options.onPlan?.(answer);
    return answer;
  } catch (error) {
    if (error instanceof MuseRequestError && error.kind === "authRequired") throw signedOutError("muse");
    throw error;
  } finally {
    clearTimeout(cancelTimer);
    signal.removeEventListener("abort", interrupt);
    turnAbort.abort();
    requests.dispose();
    subagents.dispose();
    connection.onNotification = undefined;
    connection.onClose = undefined;
    if (adopted) connection.dropOrphans();
    agent.settle(!!key);
  }
}
