import { readFile } from "node:fs/promises";
import { agentName } from "../../../shared/agents";
import type { AgentDecision } from "../../../shared/agent-modes";
import { TurnText } from "../cursor/activity";
import { signedOutError } from "../errors";
import { answerLimitError } from "../turn-kit";
import type { AgentOptions } from "../types";
import { acpActivity, acpEdits, editKinds, lookKinds, planText } from "./activity";
import { AcpRequestError } from "./connection";
import type { AcpProfile } from "./profiles";
import {
  cancelledPermission,
  parseUpdate,
  permissionRequestSchema,
  picked,
  promptResultSchema,
  type AcpPermissionRequest,
  type AcpPromptResult,
  type AcpToolCall,
} from "./protocol";
import { acquireAcpAgent, openSession, type AcpAgent, type McpServer } from "./sessions";
import { applySettings } from "./settings";

/** How long a cancelled turn may take to say so before Relay stops waiting. */
const cancelGrace = 5000;

const decisionKinds: Record<Exclude<AgentDecision, "cancel">, string> = {
  accept: "allow_once",
  acceptForSession: "allow_always",
  decline: "reject_once",
};

/** The option of `kind` the agent offered, falling back along `kinds`. */
const optionOf = (request: AcpPermissionRequest, ...kinds: string[]) =>
  kinds
    .map((kind) => request.options.find((o) => o.kind === kind))
    .find(Boolean);

/** What the user sees of a permission request: the command, or the files it changes. */
function requestDetail(request: AcpPermissionRequest) {
  const raw = request.toolCall.rawInput as Record<string, unknown> | undefined;
  const command = typeof raw?.command === "string" ? raw.command : undefined;
  const paths = [
    ...(request.toolCall.content ?? []).flatMap((c) => (c.type === "diff" && c.path ? [c.path] : [])),
    ...(request.toolCall.locations ?? []).map((l) => l.path),
  ];
  return command ?? ([...new Set(paths)].join("\n") || undefined);
}

/**
 * Answers the agent's ask to run a tool. Relay's mode answers what it can;
 * the rest goes to the user, and with nobody to ask the tool is refused.
 */
async function permission(
  options: AgentOptions,
  name: string,
  raw: unknown,
  signal: AbortSignal,
) {
  const request = permissionRequestSchema.parse(raw);
  const kind = request.toolCall.kind ?? "other";
  const allow = () => optionOf(request, "allow_once", "allow_always");
  const reject = () => optionOf(request, "reject_once", "reject_always");
  const answer = (option?: { optionId: string }) =>
    option ? picked(option.optionId) : cancelledPermission;
  if (signal.aborted) return cancelledPermission;
  if (options.job.kind === "helper") return answer(reject());
  if (options.readOnly && !lookKinds.has(kind)) return answer(reject());
  if (options.runtimeMode === "full-access") return answer(allow());
  if (options.runtimeMode === "auto-accept-edits" && editKinds.has(kind)) return answer(allow());
  if (!options.onRequest || options.readOnly) return answer(reject());

  const decisions = (Object.keys(decisionKinds) as (keyof typeof decisionKinds)[]).filter(
    (decision) => request.options.some((o) => o.kind === decisionKinds[decision]),
  );
  const response = await options.onRequest(
    {
      kind: "approval",
      title: request.toolCall.title || `${name} wants to run a tool`,
      detail: requestDetail(request),
      decisions,
    },
    signal,
  ).catch(() => undefined);
  if (signal.aborted || response?.kind !== "approval") return cancelledPermission;
  if (response.decision === "cancel") return answer(reject());
  return answer(optionOf(request, decisionKinds[response.decision]) ?? reject());
}

/** The turn's prompt as ACP content blocks. */
async function promptBlocks(options: AgentOptions, agent: AcpAgent, name: string) {
  const { job } = options;
  const helper = job.kind === "helper" ? job : undefined;
  const note = helper ? undefined : await options.context?.().catch(() => undefined);
  const text = job.kind === "compact" ? agent.profile.compact! : options.prompt;
  const blocks: object[] = [
    { type: "text", text: [helper?.instructions, note, text].filter(Boolean).join("\n\n") },
  ];
  if (options.images?.length) {
    if (!agent.caps?.image) throw new Error(`${name} can't read images.`);
    for (const image of options.images)
      blocks.push({
        type: "image",
        mimeType: image.mimeType,
        data: (await readFile(image.path)).toString("base64"),
      });
  }
  return blocks;
}

/** Relay's own tools, where the agent takes MCP servers over HTTP. */
const mcpServers = (options: AgentOptions, agent: AcpAgent): McpServer[] =>
  options.relayTools && agent.caps?.http
    ? [
        {
          type: "http",
          name: "relay",
          url: options.relayTools.url,
          headers: [{ name: "Authorization", value: `Bearer ${options.relayTools.token}` }],
        },
      ]
    : [];

/** Runs one turn on an ACP agent, starting or picking up its session in the thread's process. */
export async function runAcp(profile: AcpProfile, options: AgentOptions): Promise<string> {
  const { signal, job } = options;
  const name = agentName(profile.provider);
  signal.throwIfAborted();
  if (job.kind === "compact" && !profile.compact)
    throw new Error(`${name} summarizes a long thread on its own; there is nothing to compact by hand.`);
  if (job.kind === "side" || options.session?.fork)
    throw new Error(`${name} can't copy a conversation, so it can't answer beside the thread.`);
  if (job.kind === "review" || job.kind === "goal")
    throw new Error(`${name} has no /${job.kind}.`);

  // Started signed out, Antigravity would open its sign-in page unasked.
  if (job.kind !== "adopt" && (await profile.account?.())?.signedIn === false)
    throw signedOutError(profile.provider);

  // A helper job is one bare question in a process of its own, never the thread's.
  const key = job.kind === "helper" ? undefined : options.session?.key;
  // A thread is read-only from its start, so its process can be started that way.
  const readOnly = options.readOnly ? await profile.readOnlyEnv?.(options.cwd) : undefined;
  if (readOnly?.warning) options.onCommentary?.(`${profile.provider}-read-only`, readOnly.warning);
  const agent = await acquireAcpAgent(profile, key, options.cwd, {
    ...options.env,
    ...readOnly?.env,
  });
  const { connection } = agent;
  const adopted = job.kind === "adopt" ? agent.inflight : undefined;
  if (job.kind === "adopt" && (!adopted || !agent.session)) {
    agent.busy = false;
    throw new Error(`There is no ${name} turn to pick up.`);
  }

  const turn = new TurnText(options.onText, options.onCommentary, profile.provider);
  const calls = new Map<string, Partial<AcpToolCall> & { toolCallId: string }>();
  let cost: number | undefined;
  let overflow!: (error: Error) => void;
  const overflowed = new Promise<never>((_, reject) => (overflow = reject));
  void overflowed.catch(() => {});
  const turnAbort = new AbortController();
  const stop = () => turnAbort.abort();
  signal.addEventListener("abort", stop, { once: true });

  let sessionId = agent.session?.id;
  const cancel = () => {
    if (sessionId) connection.notify("session/cancel", { sessionId });
  };
  turnAbort.signal.addEventListener("abort", cancel, { once: true });

  const hear = (raw: unknown) => {
    const update = parseUpdate(raw);
    if (!update) return;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (update.content.type !== "text") return;
        turn.add(update.content.text ?? "");
        const over = answerLimitError(turn.size);
        if (over && !turnAbort.signal.aborted) {
          overflow(over);
          stop();
        }
        return;
      }
      case "agent_thought_chunk":
        return;
      case "tool_call":
      case "tool_call_update": {
        const { sessionUpdate: _, ...fields } = update;
        const known = calls.get(update.toolCallId);
        const call = { ...known, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null)) } as Partial<AcpToolCall> & { toolCallId: string };
        calls.set(update.toolCallId, call);
        if (!known) turn.toCommentary();
        options.onActivity?.(acpActivity(call));
        const edits = acpEdits(call);
        if (edits.length) options.onEdit?.(edits);
        return;
      }
      case "plan":
        if (update.entries.length)
          options.onActivity?.({
            id: `${profile.provider}-plan`,
            kind: "tool",
            status: "complete",
            label: "Updated the plan",
            detail: planText(update.entries),
          });
        return;
      case "current_mode_update": {
        const modes = agent.session?.settings.modes;
        if (modes) modes.currentModeId = update.currentModeId;
        return;
      }
      case "config_option_update":
        if (agent.session) agent.session.settings.configOptions = update.configOptions;
        return;
      case "session_info_update":
        if (update.title) options.onTitle?.(update.title);
        return;
      case "usage_update":
        options.onContext?.({
          usedTokens: update.used,
          ...(update.size ? { maxTokens: update.size } : {}),
        });
        // The session's cost so far; a turn counts what it added.
        if (update.cost && (!update.cost.currency || update.cost.currency === "USD")) {
          const spent = cost === undefined ? 0 : update.cost.amount - cost;
          cost = update.cost.amount;
          if (spent > 0) options.onCost?.(spent);
        }
        return;
    }
  };

  connection.onRequest = async (method, params) => {
    if (method === "session/request_permission")
      return permission(options, name, params, turnAbort.signal);
    throw new AcpRequestError(-32601, `Relay doesn't offer ${method}.`, null, method);
  };

  let cancelTimer: NodeJS.Timeout | undefined;
  try {
    connection.mark("start");
    let reply: Promise<unknown>;
    if (adopted) {
      connection.listen(sessionId!, hear);
      reply = connection.wait(adopted.id, "session/prompt");
      // What it said while Relay was away comes now, with a listener in place.
      connection.resume();
    } else {
      const opened = await openSession(agent, {
        id: job.kind === "helper" ? undefined : options.session?.id,
        cwd: options.cwd,
        mcpServers: mcpServers(options, agent),
      });
      sessionId = opened.id;
      if (key && opened.id !== options.session?.id) await options.session?.onId(opened.id);
      if (opened.lost)
        options.onCommentary?.(
          `${profile.provider}-lost`,
          `${name} couldn't open the earlier conversation, so this turn starts a new one.`,
        );
      await applySettings(
        connection,
        agent.session!,
        profile.wishes({
          runtime: options.runtimeMode,
          interaction: options.interactionMode,
          readOnly: options.readOnly || job.kind === "helper",
        }),
        options.choice,
      );
      const prompt = await promptBlocks(options, agent, name);
      signal.throwIfAborted();
      connection.listen(opened.id, hear);
      const id = connection.reserve();
      agent.keep({ id });
      reply = connection.request("session/prompt", { sessionId: opened.id, prompt }, id);
    }
    void reply.catch(() => {});
    // The agent reports the cancel; if it doesn't, stop waiting anyway.
    const cancelled = new Promise<never>((_, reject) => {
      turnAbort.signal.addEventListener(
        "abort",
        () => {
          cancelTimer = setTimeout(() => reject(new Error("Cancelled by you.")), cancelGrace);
          cancelTimer.unref();
        },
        { once: true },
      );
    });
    void cancelled.catch(() => {});
    if (signal.aborted) stop();
    const result: AcpPromptResult = promptResultSchema.parse(
      await Promise.race([reply, cancelled, overflowed]),
    );
    finish(options, profile, result, turn, name);
    const answer = turn.answer();
    const failed = calls.size === 0 ? profile.failure?.(answer) : undefined;
    if (failed) {
      options.onText("");
      throw new Error(`${name}: ${failed}`);
    }
    if (options.interactionMode === "plan" && answer.trim()) options.onPlan?.(answer);
    return answer;
  } finally {
    clearTimeout(cancelTimer);
    signal.removeEventListener("abort", stop);
    // Answers whatever the agent still asks of a turn that's over, without cancelling it.
    turnAbort.signal.removeEventListener("abort", cancel);
    turnAbort.abort();
    if (sessionId) connection.unlisten(sessionId);
    connection.onRequest = undefined;
    // What the last Relay's cancels were answered with, in the replay.
    if (adopted) connection.dropOrphans();
    settle(agent, !!key);
  }
}

/** Reads how the turn ended: a reason to fail it, and what it used. */
function finish(
  options: AgentOptions,
  profile: AcpProfile,
  result: AcpPromptResult,
  turn: TurnText,
  name: string,
) {
  const usage = result.usage;
  if (usage)
    options.onUsage?.({
      model: options.choice.model || profile.provider,
      tokens: {
        input: usage.inputTokens ?? 0,
        cacheWrite: usage.cachedWriteTokens ?? 0,
        cacheRead: usage.cachedReadTokens ?? 0,
        output: (usage.outputTokens ?? 0) + (usage.thoughtTokens ?? 0),
      },
    });
  switch (result.stopReason) {
    case "cancelled":
      throw new Error("Cancelled by you.");
    case "refusal":
      throw new Error(`${name} refused to go on.`);
    case "max_tokens":
      if (!turn.answer()) throw new Error(`${name} ran out of tokens before it answered.`);
      return;
    case "max_turn_requests":
      if (!turn.answer()) throw new Error(`${name} reached its limit of steps for one turn.`);
  }
}

/** The turn is over: the process keeps its session for the next, unless it was a private one. */
function settle(agent: AcpAgent, kept: boolean) {
  agent.inflight = undefined;
  agent.busy = false;
  if (!kept) return agent.close();
  agent.connection.mark("end");
  agent.keep();
}
