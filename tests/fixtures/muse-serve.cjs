#!/usr/bin/env node
// A stand-in for `muse serve`: MSP (JSON-RPC 2.0, a message per line) on
// stdio, playing the turn RELAY_MUSE_SCENARIO describes and logging what
// Relay sent to RELAY_MUSE_LOG.
const { appendFileSync } = require("node:fs");
const { createInterface } = require("node:readline");

const scenario = JSON.parse(process.env.RELAY_MUSE_SCENARIO || "{}");
const log = process.env.RELAY_MUSE_LOG;
let cursor = 0;
let sessions = 0;
let current = { sessionId: "", turnId: "" };
/** What a scripted step is waiting for from Relay, by method. */
const waiting = new Map();

const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const notify = (method, params) =>
  send({ method, params: { sessionId: current.sessionId, viewCursor: `v:${++cursor}`, ...params } });
const reply = (id, result) => send({ id, result });
const fail = (id, code, kind, message) => send({ id, error: { code, message, data: { kind } } });
const until = (method) => new Promise((resolve) => waiting.set(method, resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const session = (sessionId) => ({
  sessionId,
  path: `/tmp/${sessionId}.jsonl`,
  status: "idle",
  activeTurnId: null,
  modelId: scenario.sessionModel ?? null,
  turnCount: 0,
});

function item(kind, fields, status = "completed") {
  return { itemId: fields.itemId, kind, status, turnId: current.turnId, revision: 1, ...fields };
}

let n = 0;
async function play(steps) {
  for (const step of steps) {
    const id = `item-${++n}`;
    if (step.text !== undefined) {
      notify("item/started", { item: item("agentMessage", { itemId: id, text: "" }, "inProgress") });
      for (const chunk of [].concat(step.chunks ?? step.text))
        notify("item/delta", { itemId: id, field: "text", delta: chunk });
      notify("item/completed", { item: item("agentMessage", { itemId: id, text: step.text }) });
    }
    if (step.reasoning) {
      notify("item/started", { item: item("reasoning", { itemId: id, summary: [""] }, "inProgress") });
      notify("item/delta", { itemId: id, field: "summary.0", delta: step.reasoning });
      notify("item/completed", { item: item("reasoning", { itemId: id, summary: [step.reasoning] }) });
    }
    if (step.tool) {
      const call = { itemId: id, tool: step.tool.tool, args: JSON.stringify(step.tool.args ?? {}) };
      notify("item/started", { item: item("toolCall", call, "inProgress") });
      notify("item/completed", {
        item: item("toolCall", { ...call, visibleOutput: step.tool.output, ...step.tool.extra }, step.tool.status ?? "completed"),
      });
    }
    if (step.subagent) {
      const agent = { itemId: id, subagentId: `sub-${n}`, childSessionId: `child-${n}`, objective: step.subagent.objective };
      notify("item/started", { item: item("subagent", agent, "inProgress") });
      if (step.subagent.child) {
        // The child's own view, once Relay follows it.
        const subscribed = await Promise.race([until("view/subscribe"), sleep(1000)]);
        if (subscribed) {
          const saved = current.sessionId;
          current.sessionId = agent.childSessionId;
          notify("item/started", { item: item("toolCall", { itemId: `${id}-c`, tool: step.subagent.child.tool, args: JSON.stringify(step.subagent.child.args) }, "inProgress") });
          notify("item/completed", { item: item("toolCall", { itemId: `${id}-c`, tool: step.subagent.child.tool, args: JSON.stringify(step.subagent.child.args) }) });
          current.sessionId = saved;
        }
      }
      notify("item/completed", { item: item("subagent", { ...agent, result: { summary: step.subagent.result } }) });
    }
    if (step.reminder)
      notify("item/completed", { item: item("reminderChild", { itemId: id, reminderAgentId: "verify-reminder" }) });
    if (step.approval) {
      const approvalId = `approval-${n}`;
      notify("approval/requested", {
        approvalId,
        itemId: id,
        turnId: current.turnId,
        toolName: "shell",
        rawArgs: "{}",
        toolCallId: "call",
        taskId: "task",
        judgeEscalated: false,
        protectedWrite: false,
        currentRequirementId: { approvalId, sourceIndex: 0 },
        subject: step.approval.subject ?? { kind: "shell", command: "rm -rf build" },
        availableChoices: step.approval.choices ?? [
          { choiceId: "once", decision: "approved", label: "Yes", scope: "once" },
          { choiceId: "session", decision: "approvedForSession", label: "Always", scope: "session" },
          { choiceId: "no", decision: "denied", label: "No", scope: "once" },
          { choiceId: "abort", decision: "abort", label: "Stop", scope: "once" },
        ],
      });
      const decided = await until("approval/decide");
      notify("approval/resolved", { approvalId, decision: decided.choiceId, resolvedBy: "user" });
    }
    if (step.question) {
      const userInputId = `input-${n}`;
      notify("userInput/requested", {
        userInputId,
        itemId: id,
        turnId: current.turnId,
        toolCallId: "call",
        toolName: "ask_user",
        questions: step.question,
      });
      await Promise.race([until("userInput/answer"), until("userInput/cancel")]);
      notify("userInput/settled", { userInputId, answers: [], outcome: "answered" });
    }
    if (step.usage) notify("session/tokenUsage", { turnId: current.turnId, modelId: step.usage.model ?? "muse-spark-1.3", usage: step.usage.tokens });
    if (step.context) notify("session/contextUsage", step.context);
    if (step.todos) notify("session/todoListChanged", { items: step.todos, revision: 1, sourceTool: "todo_write" });
    if (step.title) notify("session/nameChanged", { name: step.title });
    if (step.subscription) notify("usage/changed", step.subscription);
    if (step.waitSteer) {
      const steer = await until("turn/steer");
      notify("item/completed", {
        item: item("userMessage", { itemId: id, text: steer.input[0]?.text, commandId: steer.commandId, steered: true }),
      });
    }
    if (step.hang) return new Promise(() => {});
    if (step.waitFile)
      while (!require("node:fs").existsSync(step.waitFile)) await sleep(20);
    if (step.sleep) await sleep(step.sleep);
    if (step.fail)
      return notify("turn/completed", { turnId: current.turnId, terminal: "failed", error: { retryable: false, ...step.fail } });
  }
  notify("turn/completed", { turnId: current.turnId, terminal: "completed", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, reasoningTokens: 0 } });
}

const handlers = {
  initialize: () => ({
    serverInfo: { name: "muse", version: "1.4.7" },
    grantedCapabilities: ["sessionMcp"],
    experimentalApi: true,
    sessionDurability: "durable",
    schema: { version: 1 },
  }),
  "session/start": () => {
    current.sessionId = scenario.newSessionId ?? `session-${++sessions}`;
    notify("session/started", { session: session(current.sessionId) });
    return { session: session(current.sessionId), viewCursor: `v:${cursor}` };
  },
  "session/resume": (params, id) => {
    if (scenario.resume === "missing") return fail(id, -32020, "sessionNotFound", "no such session");
    if (scenario.resume === "inUse") return fail(id, -32021, "sessionInUse", "session in use");
    current.sessionId = params.sessionId;
    return { session: session(params.sessionId), viewCursor: `v:${cursor}`, history: { mode: "none", items: null, snapshot: null } };
  },
  "session/fork": () => {
    current.sessionId = `fork-${++sessions}`;
    return { session: session(current.sessionId), viewCursor: `v:${cursor}`, history: { mode: "none", items: null, snapshot: null } };
  },
  // Shaped as real Muse checks them: a wrong name is invalid params.
  "session/setPermissionProfile": (params, id) =>
    typeof params.profileId === "string"
      ? { status: "accepted", applyOutcome: "completed" }
      : fail(id, -32602, "invalidParams", "Invalid params: session/setPermissionProfile params"),
  "session/setApprovalMode": (params, id) =>
    typeof params.mode === "string" ? { status: "accepted" } : fail(id, -32602, "invalidParams", "Invalid params"),
  "session/setModel": (params, id) =>
    typeof params.model?.modelId === "string" ? { status: "accepted" } : fail(id, -32602, "invalidParams", "Invalid params"),
  "model/list": (_, id) =>
    scenario.signedOut
      ? fail(id, -32030, "authRequired", "missing meta credentials: run `muse login`")
      : { providerId: "meta", profileId: "tbh", source: "providerCatalog", models: scenario.models ?? [] },
  "skill/list": () => ({ skills: scenario.skills ?? [] }),
  "usage/read": () => (scenario.subscription ? { usage: scenario.subscription } : {}),
  "turn/start": (params, id) => {
    if (scenario.signedOut) return fail(id, -32030, "authRequired", "missing meta credentials");
    current.turnId = params.commandId;
    reply(id, { commandId: params.commandId, status: "accepted", turnId: params.commandId, startedNewTurn: true, disposition: "started" });
    notify("turn/started", { turnId: current.turnId, commandId: params.commandId });
    void play(scenario.turn ?? [{ text: "Done." }]);
  },
  "turn/steer": (params) => ({ commandId: params.commandId, status: "accepted", turnId: current.turnId }),
  "turn/interrupt": (params, id) => {
    reply(id, { commandId: params.commandId, status: "accepted" });
    if (!scenario.ignoreInterrupt) notify("turn/completed", { turnId: current.turnId, terminal: "cancelled" });
  },
  "session/compact": (params, id) => {
    if (scenario.compact === "noop") return { commandId: params.commandId, status: "noop", reason: "no_compactable_history" };
    reply(id, { commandId: params.commandId, status: "accepted" });
    notify("item/started", { item: { itemId: "compaction-1", kind: "compaction", status: "inProgress", revision: 1, turnId: null } });
    notify("item/completed", { item: { itemId: "compaction-1", kind: "compaction", status: "completed", revision: 2, turnId: null, tokensBefore: 120000, tokensAfter: 9000 } });
  },
  "approval/decide": (params) => ({ approvalId: params.approvalId, commandId: params.commandId, status: "accepted", terminal: true }),
  "userInput/answer": (params) => ({ commandId: params.commandId, status: "accepted" }),
  "userInput/cancel": (params) => ({ commandId: params.commandId, status: "accepted" }),
  "view/subscribe": () => ({ viewCursor: `v:${cursor}` }),
  "view/unsubscribe": () => ({}),
  "subagent/stop": (params) => ({ commandId: params.commandId, status: "accepted" }),
};

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (log) appendFileSync(log, line + "\n");
  const resolve = waiting.get(message.method);
  if (resolve) {
    waiting.delete(message.method);
    resolve(message.params);
  }
  const handler = handlers[message.method];
  if (message.id === undefined) return;
  if (!handler) return fail(message.id, -32601, "methodNotFound", "method not found");
  const result = handler(message.params ?? {}, message.id);
  if (result !== undefined) reply(message.id, result);
});
process.stdin.on("end", () => process.exit(0));
