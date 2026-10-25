import { readFile } from "node:fs/promises";
import { agentName } from "../../../shared/agents";
import type { AgentDecision } from "../../../shared/agent-modes";
import { signedOutError } from "../errors";
import { CANCEL_GRACE_MS, cancelledByYou, TurnText } from "../turn-kit";
import type { AgentOptions } from "../types";
import { editKinds, lookKinds } from "./activity";
import { AcpRequestError } from "./connection";
import { answerElicitation } from "./elicitation";
import type { AcpProfile } from "./profiles";
import {
  cancelledPermission,
  permissionRequestSchema,
  picked,
  promptResultSchema,
  AUTH_REQUIRED,
  type AcpPermissionRequest,
  type AcpPromptResult,
} from "./protocol";
import {
  acquireAcpAgent,
  openSession,
  type AcpAgent,
  type McpServer,
} from "./sessions";
import { applySettings } from "./settings";
import {
  answerAntigravityQuestion,
  antigravityHelper,
  compactAntigravity,
} from "../antigravity";
import { AcpTurnEvents } from "./turn-events";

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
    ...(request.toolCall.content ?? []).flatMap((c) =>
      c.type === "diff" && c.path ? [c.path] : [],
    ),
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
  isAntigravity: boolean,
) {
  const request = permissionRequestSchema.parse(raw);
  if (isAntigravity && request.toolCall.toolCallId?.startsWith("interaction_"))
    return answerAntigravityQuestion(options, request, signal);
  const kind = request.toolCall.kind ?? "other";
  const allow = () => optionOf(request, "allow_once", "allow_always");
  const reject = () => optionOf(request, "reject_once", "reject_always");
  const answer = (option?: { optionId: string }) =>
    option ? picked(option.optionId) : cancelledPermission;
  if (signal.aborted) return cancelledPermission;
  if (
    options.job.kind === "helper" ||
    (isAntigravity && options.job.kind === "compact")
  )
    return answer(reject());
  if (options.readOnly && !lookKinds.has(kind)) return answer(reject());
  if (options.runtimeMode === "full-access") return answer(allow());
  if (options.runtimeMode === "auto-accept-edits" && editKinds.has(kind))
    return answer(allow());
  if (!options.onRequest || options.readOnly) return answer(reject());

  const decisions = (
    Object.keys(decisionKinds) as (keyof typeof decisionKinds)[]
  ).filter((decision) =>
    request.options.some((o) => o.kind === decisionKinds[decision]),
  );
  const response = await options
    .onRequest(
      {
        kind: "approval",
        title: request.toolCall.title || `${name} wants to run a tool`,
        detail: requestDetail(request),
        decisions,
      },
      signal,
    )
    .catch(() => undefined);
  if (signal.aborted || response?.kind !== "approval")
    return cancelledPermission;
  if (response.decision === "cancel") return answer(reject());
  return answer(
    optionOf(request, decisionKinds[response.decision]) ?? reject(),
  );
}

/** The turn's prompt as ACP content blocks. */
async function promptBlocks(
  options: AgentOptions,
  agent: AcpAgent,
  name: string,
  profile: AcpProfile,
) {
  const { job } = options;
  const helper = job.kind === "helper" ? job : undefined;
  const note =
    helper || job.kind === "compact"
      ? undefined
      : await options.context?.().catch(() => undefined);
  const text = job.kind === "compact" ? profile.compact! : options.prompt;
  const body = [
    helper &&
      "This is a text-only helper request. Do not use tools, ask questions, or invoke slash commands.",
    helper?.instructions,
    note,
    text,
  ]
    .filter(Boolean)
    .join("\n\n");
  const planning =
    job.kind === "prompt" &&
    options.interactionMode === "plan" &&
    agent.profile.plan;
  const skills =
    job.kind === "prompt"
      ? ((await agent.profile.skillContext?.(options)) ?? [])
      : [];
  const blocks: object[] = [
    ...skills.map((text) => ({
      type: "text",
      text,
      annotations: { audience: ["assistant"] },
    })),
    { type: "text", text: planning ? `${agent.profile.plan} ${body}` : body },
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
          headers: [
            {
              name: "Authorization",
              value: `Bearer ${options.relayTools.token}`,
            },
          ],
        },
      ]
    : [];

export type AcpRunObserver = {
  /** Drains native events before the ACP turn settles, including steer acknowledgements. */
  settle(): Promise<void>;
  failure?: Promise<never>;
};

/** `steered` acknowledges a steer the native API saw read, so its answer goes below it. */
type Observe = (
  agent: AcpAgent,
  steered: (id: string) => void,
) => Promise<AcpRunObserver>;

/**
 * Runs one turn on an ACP agent, starting or picking up its session in the
 * thread's process. Native APIs may augment ACP through `observe` without
 * replacing its per-session MCP and approvals.
 */
export async function runAcp(
  profile: AcpProfile,
  options: AgentOptions,
  observe?: Observe,
): Promise<string> {
  if (profile.provider === "antigravity" && options.job.kind === "compact")
    return compactAntigravity(profile, options, runAcpTurn);
  if (profile.provider !== "antigravity" || options.job.kind !== "helper")
    return runAcpTurn(profile, options, observe);
  options.signal.throwIfAborted();
  const helper = await antigravityHelper(profile.home);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 180_000);
  let sessionId: string | undefined;
  try {
    const answer = await runAcpTurn(profile, {
      ...options,
      cwd: helper.cwd,
      signal: AbortSignal.any([options.signal, deadline.signal]),
      session: {
        onId: async (id) => {
          sessionId = id;
        },
      },
      relayTools: undefined,
      readOnly: true,
    });
    await helper.check();
    return answer;
  } catch (error) {
    if (deadline.signal.aborted && !options.signal.aborted)
      throw new Error("Antigravity reached the three-minute helper limit.");
    throw error;
  } finally {
    clearTimeout(timer);
    await helper.close(sessionId);
  }
}

async function runAcpTurn(
  profile: AcpProfile,
  options: AgentOptions,
  observe?: Observe,
): Promise<string> {
  const { signal, job } = options;
  const name = agentName(profile.provider);
  signal.throwIfAborted();
  if (job.kind === "compact" && !profile.compact)
    throw new Error(
      `${name} summarizes a long thread on its own; there is nothing to compact by hand.`,
    );
  if (job.kind === "side" || options.session?.fork)
    throw new Error(
      `${name} can't copy a conversation, so it can't answer beside the thread.`,
    );
  if (job.kind === "review" || job.kind === "goal")
    throw new Error(`${name} has no /${job.kind}.`);

  // Started signed out, Antigravity would open its sign-in page unasked.
  if (job.kind !== "adopt" && (await profile.account?.())?.signedIn === false)
    throw signedOutError(profile.provider);

  // A helper job is one bare question in a process of its own, never the thread's.
  const key = job.kind === "helper" ? undefined : options.session?.key;
  // A thread is read-only from its start, so its process can be started that way.
  const readOnly = options.readOnly
    ? await profile.readOnlyEnv?.(options.cwd)
    : undefined;
  if (readOnly?.warning)
    options.onCommentary?.(`${profile.provider}-read-only`, readOnly.warning);
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

  let overflow!: (error: Error) => void;
  const overflowed = new Promise<never>((_, reject) => (overflow = reject));
  void overflowed.catch(() => {});
  const turnAbort = new AbortController();
  const stop = () => turnAbort.abort();
  signal.addEventListener("abort", stop, { once: true });
  const events = new AcpTurnEvents(
    profile,
    options,
    agent,
    key,
    (error) => {
      overflow(error);
      stop();
    },
    () => turnAbort.signal.aborted,
  );
  const { turn, calls, batches, hear } = events;
  const steered = (id: string) => {
    turn.below();
    options.onSteered?.(id);
  };

  let sessionId = agent.session?.id;
  const cancel = () => {
    if (sessionId) connection.notify("session/cancel", { sessionId });
  };
  turnAbort.signal.addEventListener("abort", cancel, { once: true });

  connection.onRequest = async (method, params) => {
    if (method === "session/request_permission")
      return permission(
        options,
        name,
        params,
        turnAbort.signal,
        profile.provider === "antigravity",
      );
    if (method === "elicitation/create")
      return answerElicitation(
        options,
        name,
        params,
        turnAbort.signal,
        events.asking,
      );
    throw new AcpRequestError(
      -32601,
      `Relay doesn't offer ${method}.`,
      null,
      method,
    );
  };

  let observer: AcpRunObserver | undefined;
  let cancelTimer: NodeJS.Timeout | undefined;
  try {
    connection.mark("start");
    let reply: Promise<unknown>;
    if (adopted) {
      connection.listen(sessionId!, hear);
      reply = connection.wait(adopted.id, "session/prompt");
      void reply.catch(() => {});
      try {
        observer = await observe?.(agent, steered);
      } finally {
        // What it said while Relay was away comes now, with a listener in
        // place. Held back after a failed start, the process would answer
        // nothing ever again, this turn or the next.
        connection.resume();
      }
    } else {
      const opened = await openSession(agent, {
        id: job.kind === "helper" ? undefined : options.session?.id,
        cwd: options.cwd,
        mcpServers: mcpServers(options, agent),
      });
      sessionId = opened.id;
      if (opened.id !== options.session?.id)
        await options.session?.onId(opened.id);
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
      const prompt = await promptBlocks(options, agent, name, profile);
      signal.throwIfAborted();
      connection.listen(opened.id, hear);
      observer = await observe?.(agent, steered);
      signal.throwIfAborted();
      const id = connection.reserve();
      agent.keep({
        id,
        ...(profile.provider === "antigravity" && job.kind === "compact"
          ? { compaction: true }
          : {}),
      });
      reply = connection.request(
        "session/prompt",
        { sessionId: opened.id, prompt },
        id,
      );
    }
    void reply.catch(() => {});
    // The agent reports the cancel; if it doesn't, stop waiting anyway.
    const cancelled = new Promise<never>((_, reject) => {
      turnAbort.signal.addEventListener(
        "abort",
        () => {
          cancelTimer = setTimeout(
            () => reject(cancelledByYou()),
            CANCEL_GRACE_MS,
          );
          cancelTimer.unref();
        },
        { once: true },
      );
    });
    void cancelled.catch(() => {});
    if (signal.aborted) stop();
    const result: AcpPromptResult = promptResultSchema.parse(
      await Promise.race([
        reply,
        cancelled,
        overflowed,
        ...(observer?.failure ? [observer.failure] : []),
      ]),
    );
    await observer?.settle();
    finish(options, profile, result, turn, name);
    const answer = turn.answer();
    const failed = calls.size === 0 ? profile.failure?.(answer) : undefined;
    if (failed) {
      options.onText("");
      throw new Error(`${name}: ${failed}`);
    }
    if (options.interactionMode === "plan" && answer.trim())
      options.onPlan?.(answer);
    return answer;
  } catch (error) {
    if (observer) {
      cancel();
      await observer.settle().catch(() => {});
    }
    if (error instanceof AcpRequestError && error.code === AUTH_REQUIRED) {
      // Its process owns cached credentials. A new login must get a fresh process.
      agent.close();
      throw signedOutError(
        profile.provider,
        profile.provider === "opencode"
          ? "OpenCode's model provider needs you to sign in again. Reconnect the provider, then resume the answer."
          : undefined,
      );
    }
    throw error;
  } finally {
    batches?.settle(signal.aborted || turnAbort.signal.aborted);
    clearTimeout(cancelTimer);
    signal.removeEventListener("abort", stop);
    // Answers whatever the agent still asks of a turn that's over, without cancelling it.
    turnAbort.signal.removeEventListener("abort", cancel);
    turnAbort.abort();
    if (sessionId) connection.unlisten(sessionId);
    connection.onRequest = undefined;
    // What the last Relay's cancels were answered with, in the replay.
    if (adopted) connection.dropOrphans();
    agent.settle(!!key);
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
      if (!turn.answer())
        throw new Error(`${name} ran out of tokens before it answered.`);
      return;
    case "max_turn_requests":
      if (!turn.answer())
        throw new Error(`${name} reached its limit of steps for one turn.`);
  }
}
