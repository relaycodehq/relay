// An ACP agent (protocol version 1) on stdio, playing the turn
// RELAY_ACP_SCENARIO describes and writing every message Relay sends to
// RELAY_ACP_LOG, one JSON line each.
//
// Scenario fields, all optional:
//   signIn: an auth method id; sessions need `authenticate` with it first
//   refuse: what `authenticate` fails with, as a service that turned the login down
//   resume: offer session/resume; `sessions` lists the ids it can resume
//   configOptions: what session/new answers, and set_config_option updates
//   turn: steps for each session/prompt, in order:
//     { update }            a session/update
//     { ask: { toolCall, options } }  a request_permission, waited on
//     { waitCancel: true }  waits for session/cancel and stops as cancelled
//   stopReason, usage: how session/prompt ends ("end_turn" by default)
const fs = require("node:fs");
const scenario = JSON.parse(process.env.RELAY_ACP_SCENARIO || "{}");
const log = (v) =>
  process.env.RELAY_ACP_LOG &&
  fs.appendFileSync(process.env.RELAY_ACP_LOG, JSON.stringify(v) + "\n");
const send = (v) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...v }) + "\n");

let signedIn = !scenario.signIn;
let nextId = 1000;
let sessionCount = 0;
let options = scenario.configOptions ?? [];
const waiting = new Map();
let cancelled;

const ask = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    send({ id, method, params });
  });

async function prompt(m) {
  const sessionId = m.params.sessionId;
  for (const step of scenario.turn ?? []) {
    if (step.update)
      send({
        method: "session/update",
        params: { sessionId, update: step.update },
      });
    if (step.ask)
      await ask("session/request_permission", { sessionId, ...step.ask });
    if (step.waitCancel) {
      await new Promise((resolve) => (cancelled = resolve));
      return send({ id: m.id, result: { stopReason: "cancelled" } });
    }
  }
  send({
    id: m.id,
    result: {
      stopReason: scenario.stopReason ?? "end_turn",
      ...(scenario.usage ? { usage: scenario.usage } : {}),
    },
  });
}

const needsSignIn = (m) =>
  !signedIn &&
  send({ id: m.id, error: { code: -32000, message: "Authentication required" } });

require("node:readline")
  .createInterface({ input: process.stdin })
  .on("line", (line) => {
    const m = JSON.parse(line);
    log(m);
    if (m.method === undefined) return waiting.get(m.id)?.(m.result);
    switch (m.method) {
      case "initialize":
        // Gemini rejects a clientInfo without a version.
        if (m.params.clientInfo && typeof m.params.clientInfo.version !== "string")
          return send({ id: m.id, error: { code: -32603, message: "Internal error" } });
        return send({
          id: m.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
              promptCapabilities: { image: false },
              mcpCapabilities: { http: true },
              sessionCapabilities: scenario.resume ? { resume: {} } : {},
            },
            authMethods: scenario.signIn
              ? [{ id: scenario.signIn, name: "Sign in" }]
              : [],
          },
        });
      case "authenticate":
        if (scenario.refuse)
          return send({ id: m.id, error: { code: -32000, message: scenario.refuse } });
        signedIn = m.params.methodId === scenario.signIn;
        return send({ id: m.id, result: {} });
      case "session/new":
        if (needsSignIn(m)) return;
        return send({
          id: m.id,
          result: { sessionId: `s${++sessionCount}`, configOptions: options },
        });
      case "session/resume":
        if (needsSignIn(m)) return;
        if (!(scenario.sessions ?? []).includes(m.params.sessionId))
          return send({ id: m.id, error: { code: -32002, message: "No such session" } });
        return send({ id: m.id, result: { configOptions: options } });
      case "session/set_config_option":
        options = options.map((o) =>
          o.id === m.params.configId ? { ...o, currentValue: m.params.value } : o,
        );
        return send({ id: m.id, result: { configOptions: options } });
      case "session/prompt":
        return void prompt(m);
      case "session/cancel":
        return cancelled?.();
      default:
        if (m.id !== undefined)
          send({ id: m.id, error: { code: -32601, message: "Method not found" } });
    }
  });
