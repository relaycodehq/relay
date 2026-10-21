import { readFile } from "node:fs/promises";
import { projectInstructions, sideInstructions } from "../instructions";
import { renderPrompt } from "../../../shared/html-render";
import { signedOutError, usageLimitError } from "../errors";
import { CANCEL_GRACE_MS, cancelledByYou, guardSteer } from "../turn-kit";
import type { AgentOptions } from "../types";
import { MuseRequestError } from "./connection";
import { commandId, isEffort, profiles, type MuseTurnCompleted } from "./protocol";
import {
  acquireMuse,
  openSession,
  signedIn,
  type MuseMcpServer,
  type MuseSettings,
} from "./sessions";
import { MuseTurnEvents } from "./turn-events";


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

  const turnAbort = new AbortController();
  const events = new MuseTurnEvents(connection, options, key, turnAbort.signal, () => interrupt());
  events.sessionId = agent.session?.id;
  events.turnId = adopted?.turnId;
  const { turn, ended, steers, fail } = events;
  connection.onNotification = events.notification;
  connection.onClose = (reason) => fail(new Error(connection.log ? `${reason}\n\n${connection.log.slice(-2000)}` : reason));

  const steerable = () =>
    options.onControl?.({
      steer: (text, id, images) =>
        guardSteer(
          () => !turnAbort.signal.aborted && !!events.turnId,
          () => inputOf(text, options, images ?? []),
          async (steerInput) => {
            const steer = commandId();
            if (id) steers.set(steer, id);
            await connection.request("turn/steer", {
              commandId: steer,
              sessionId: events.sessionId,
              expectedTurnId: events.turnId,
              input: steerInput,
            });
          },
        ),
    });

  let cancelTimer: NodeJS.Timeout | undefined;
  const interrupt = () => {
    if (turnAbort.signal.aborted) return;
    turnAbort.abort();
    if (events.sessionId && events.turnId)
      void connection
        .request("turn/interrupt", { commandId: commandId(), sessionId: events.sessionId, turnId: events.turnId })
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
      events.sessionId = opened.id;
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
          sessionId: events.sessionId,
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
        events.turnId = command;
        agent.inflight = { turnId: events.turnId };
        agent.keep();
        const effort = options.choice.reasoningEffort;
        const started = (await signedIn(() =>
          connection.request("turn/start", {
            commandId: command,
            sessionId: events.sessionId,
            input,
            // The transcript shows the user's own words, not what Relay put around them.
            displayText: (options.request ?? options.prompt).slice(0, 20_000),
            ...(isEffort(effort) && { reasoningEffort: effort }),
          }),
        )) as { turnId?: string };
        if (started.turnId && started.turnId !== events.turnId) {
          events.turnId = started.turnId;
          agent.inflight = { turnId: events.turnId };
          agent.keep();
        }
        steerable();
      }
    }
    if (signal.aborted) interrupt();
    const done = await ended.promise;
    if (done === "compacted") {
      const c = events.compaction;
      return c?.tokensBefore && c.tokensAfter
        ? `Compacted the conversation from ${c.tokensBefore.toLocaleString("en")} to ${c.tokensAfter.toLocaleString("en")} tokens.`
        : "Compacted the conversation.";
    }
    if (done.terminal !== "completed") throw failure(done);
    if (job.kind === "compact") return "Compacted the conversation.";
    if (events.turnId) options.session?.onPoint?.(events.turnId);
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
    events.dispose();
    connection.onNotification = undefined;
    connection.onClose = undefined;
    if (adopted) connection.dropOrphans();
    agent.settle(!!key);
  }
}
