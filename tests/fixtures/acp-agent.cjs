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
//   spend: dollars each turn adds; the turn ends with one usage_update
//     carrying the session's total, as OpenCode 2 reports it
//   spent: what resumed sessions had cost before, by id
//   skills: OpenCode 2's catalog returned by `opencode api GET /api/skill?...`
//   RELAY_ACP_SCENARIO_FILE can supply a scenario too large for an environment variable.
const fs = require("node:fs");
const scenario = JSON.parse(
  process.env.RELAY_ACP_SCENARIO_FILE
    ? fs.readFileSync(process.env.RELAY_ACP_SCENARIO_FILE, "utf8")
    : process.env.RELAY_ACP_SCENARIO || "{}",
);
const log = (v) =>
  process.env.RELAY_ACP_LOG &&
  fs.appendFileSync(process.env.RELAY_ACP_LOG, JSON.stringify(v) + "\n");
if (scenario.captureEnvKeys) log({ environment: Object.fromEntries(scenario.captureEnvKeys.map((key) => [key, process.env[key] ?? null])) });
const send = (v) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...v }) + "\n");

if (process.argv[2] === "service") {
  log({ cli: process.argv.slice(2) });
  if (process.argv[3] === "status") console.log(scenario.serviceUrl ?? "stopped");
  else if (process.argv[3] === "get" && process.argv[4] === "password") console.log(scenario.servicePassword ?? "fixture-local-password");
  else process.exit(1);
  process.exit(0);
}

if (process.argv[2] === "api") {
  log({ api: process.argv.slice(2) });
  if (scenario.skillError) {
    process.stderr.write(scenario.skillError);
    process.exit(1);
  }
  fs.writeFileSync(
    1,
    JSON.stringify(scenario.skillResponse ?? { data: scenario.skills ?? [] }),
  );
  process.exit(0);
}

let signedIn = scenario.signedIn ?? !scenario.signIn;
let nextId = 1000;
let sessionCount = 0;
let options = scenario.configOptions ?? [];
const totals = new Map();
const waiting = new Map();
let cancelled;

const ask = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    send({ id, method, params });
  });

async function prompt(m) {
  const text = m.params.prompt?.find((block) => block.type === "text")?.text ?? "";
  const promptError = Object.entries(scenario.promptErrorByPrefix ?? {}).find(([prefix]) => text.startsWith(prefix))?.[1] ?? scenario.promptError;
  if (promptError || (scenario.authFile && !fs.existsSync(scenario.authFile)))
    return send({ id: m.id, error: promptError ?? { code: -32000, message: "Authentication required: provider authentication required" } });
  const sessionId = m.params.sessionId;
  const steps = Object.entries(scenario.turnByPrefix ?? {}).find(([prefix]) => text.startsWith(prefix))?.[1] ?? scenario.turn ?? [];
  for (const step of steps) {
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
  if (scenario.spend) {
    const total =
      (totals.get(sessionId) ?? scenario.spent?.[sessionId] ?? 0) +
      scenario.spend;
    totals.set(sessionId, total);
    send({
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "usage_update",
          used: 100,
          size: 1000,
          cost: { amount: total, currency: "USD" },
        },
      },
    });
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
        if (signedIn && scenario.saveGoogleLogin) {
          const dir = require("node:path").join(process.env.GEMINI_HOME, "antigravity-acp");
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(require("node:path").join(dir, "acp_token.json"), JSON.stringify({ refresh_token: "fixture-login" }));
        }
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
