// A stand-in for `opencode serve`: the HTTP API and event stream Relay uses,
// with one scripted turn. Requests are appended to RELAY_OPENCODE_CAPTURE.
const http = require("node:http");
const { appendFileSync } = require("node:fs");

const password = process.env.OPENCODE_SERVER_PASSWORD;
const auth = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
const capture = (entry) => {
  if (process.env.RELAY_OPENCODE_CAPTURE)
    appendFileSync(
      process.env.RELAY_OPENCODE_CAPTURE,
      JSON.stringify(entry) + "\n",
    );
};
const clients = new Set();
const sessions = new Map();
const waiting = new Map();
/** Permission requests still waiting on a reply, as `GET /permission` lists them. */
const asked = new Map();
/** Sessions in the middle of a turn, as `GET /session/status` lists them. */
const busy = new Set();
let counter = 0;
const id = (prefix) => `${prefix}_${String(++counter).padStart(6, "0")}`;
const emit = (type, properties) => {
  const frame = `data: ${JSON.stringify({ payload: { type, properties } })}\n\n`;
  for (const client of clients) client.write(frame);
};
const tick = () => new Promise((r) => setTimeout(r, 5));

async function turn(sessionID, text) {
  const session = sessions.get(sessionID);
  const user = {
    info: { id: id("msg"), role: "user", time: { created: Date.now() } },
    parts: [],
  };
  session.messages.push(user);
  busy.add(sessionID);
  emit("session.status", { sessionID, status: { type: "busy" } });
  const first = {
    id: id("msg"),
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
  };
  const firstParts = [];
  session.messages.push({ info: first, parts: firstParts });
  emit("message.updated", { sessionID, info: first });
  // Relay names a thread from its first message as it's sent.
  if (text.startsWith("Generate a short title")) {
    const part = {
      id: id("prt"),
      messageID: first.id,
      sessionID,
      type: "text",
      text: "",
    };
    firstParts.push(part);
    emit("message.part.updated", { sessionID, part });
    await tick();
    part.text = '{"title":"Notes file"}';
    emit("message.part.delta", {
      sessionID,
      messageID: first.id,
      partID: part.id,
      field: "text",
      delta: part.text,
    });
    first.time.completed = Date.now();
    busy.delete(sessionID);
    emit("session.status", { sessionID, status: { type: "idle" } });
    emit("session.idle", { sessionID });
    return;
  }
  if (text.includes("abort")) {
    session.onAbort = () => {
      first.error = {
        name: "MessageAbortedError",
        data: { message: "Aborted" },
      };
      emit("session.error", { sessionID, error: first.error });
      busy.delete(sessionID);
      emit("session.status", { sessionID, status: { type: "idle" } });
    };
    return;
  }
  const note = {
    id: id("prt"),
    messageID: first.id,
    sessionID,
    type: "text",
    text: "",
  };
  firstParts.push(note);
  emit("message.part.updated", { sessionID, part: note });
  for (const delta of ["Let me ", "check."]) {
    await tick();
    note.text += delta;
    emit("message.part.delta", {
      sessionID,
      messageID: first.id,
      partID: note.id,
      field: "text",
      delta,
    });
  }
  const tool = {
    id: id("prt"),
    messageID: first.id,
    sessionID,
    type: "tool",
    tool: "edit",
    callID: "call_1",
    state: { status: "pending", input: {} },
  };
  firstParts.push(tool);
  emit("message.part.updated", { sessionID, part: tool });
  tool.state = {
    status: "running",
    input: { filePath: `${session.directory}/notes.md` },
  };
  emit("message.part.updated", { sessionID, part: tool });
  const permission = {
    id: id("per"),
    sessionID,
    permission: "edit",
    patterns: ["notes.md"],
    metadata: { diff: "+hello" },
    always: ["*"],
    tool: { messageID: first.id, callID: "call_1" },
  };
  const reply = await new Promise((resolve) => {
    waiting.set(permission.id, resolve);
    asked.set(permission.id, permission);
    emit("permission.asked", permission);
  });
  asked.delete(permission.id);
  tool.state =
    reply === "reject"
      ? { status: "error", input: tool.state.input, error: "rejected" }
      : {
          status: "completed",
          input: tool.state.input,
          output: "Edit applied successfully.",
        };
  emit("message.part.updated", { sessionID, part: tool });
  emit("message.part.updated", {
    sessionID,
    part: {
      id: id("prt"),
      messageID: first.id,
      sessionID,
      type: "step-finish",
      cost: 0.012,
      tokens: {
        total: 1200,
        input: 1000,
        output: 200,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
  });
  first.time.completed = Date.now();
  const second = {
    id: id("msg"),
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
  };
  const answer = {
    id: id("prt"),
    messageID: second.id,
    sessionID,
    type: "text",
    text: "",
  };
  session.messages.push({ info: second, parts: [answer] });
  emit("message.updated", { sessionID, info: second });
  emit("message.part.updated", { sessionID, part: answer });
  for (const delta of [
    reply === "reject" ? "Skipped the edit" : "Wrote notes.md",
    ".",
  ]) {
    await tick();
    answer.text += delta;
    emit("message.part.delta", {
      sessionID,
      messageID: second.id,
      partID: answer.id,
      field: "text",
      delta,
    });
  }
  const finish = {
    id: id("prt"),
    messageID: second.id,
    sessionID,
    type: "step-finish",
    cost: 0.02,
    tokens: {
      total: 1500,
      input: 1300,
      output: 200,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  };
  emit("message.part.updated", { sessionID, part: finish });
  // The same step again, repriced, as a part can be updated after it lands.
  emit("message.part.updated", {
    sessionID,
    part: { ...finish, cost: 0.025 },
  });
  second.time.completed = Date.now();
  busy.delete(sessionID);
  emit("session.status", { sessionID, status: { type: "idle" } });
  emit("session.idle", { sessionID });
}

const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== auth) {
    res.writeHead(401).end();
    return;
  }
  const url = new URL(req.url, "http://localhost");
  let body = "";
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : undefined;
  const directory = url.searchParams.get("directory");
  capture({ method: req.method, path: url.pathname, directory, body: json });
  const send = (status, value) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(value === undefined ? "" : JSON.stringify(value));
  };
  const path = url.pathname;
  let m;
  if (path === "/global/health")
    return send(200, { healthy: true, version: "1.18.0" });
  if (path === "/global/event") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ payload: { type: "server.connected", properties: {} } })}\n\n`,
    );
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (path === "/provider")
    return send(200, {
      all: [
        {
          id: "anthropic",
          name: "Anthropic",
          models: {
            "claude-opus-5": {
              id: "claude-opus-5",
              name: "Claude Opus 5",
              capabilities: { toolcall: true },
              limit: { context: 1000000 },
            },
          },
        },
        {
          id: "zen",
          name: "Zen",
          models: {
            pickle: {
              id: "pickle",
              name: "Pickle",
              capabilities: { toolcall: true },
              limit: { context: 200000 },
              variants: { high: {} },
            },
          },
        },
      ],
      connected: ["zen", "anthropic"],
    });
  if (path === "/command")
    return send(200, [{ name: "init", description: "Create AGENTS.md" }]);
  if (path === "/session/status")
    return send(
      200,
      Object.fromEntries([...busy].map((id) => [id, { type: "busy" }])),
    );
  if (path === "/permission" && req.method === "GET")
    return send(200, [...asked.values()]);
  if (path === "/question" && req.method === "GET") return send(200, []);
  if (path === "/session" && req.method === "POST") {
    const session = { id: id("ses"), directory, messages: [] };
    sessions.set(session.id, session);
    return send(200, { id: session.id });
  }
  if ((m = /^\/session\/([^/]+)$/.exec(path))) {
    const session = sessions.get(m[1]);
    if (!session)
      return send(404, {
        name: "NotFoundError",
        data: { message: `Session not found: ${m[1]}` },
      });
    if (req.method === "DELETE") sessions.delete(m[1]);
    return send(200, {
      id: session.id,
      model: { id: "pickle", providerID: "zen" },
    });
  }
  if ((m = /^\/session\/([^/]+)\/message$/.exec(path)))
    return send(200, sessions.get(m[1])?.messages ?? []);
  if ((m = /^\/session\/([^/]+)\/fork$/.exec(path))) {
    const source = sessions.get(m[1]);
    const cut = json?.messageID
      ? source.messages.findIndex((x) => x.info.id === json.messageID)
      : -1;
    const session = {
      id: id("ses"),
      directory,
      messages: cut < 0 ? [...source.messages] : source.messages.slice(0, cut),
    };
    sessions.set(session.id, session);
    return send(200, { id: session.id });
  }
  if ((m = /^\/session\/([^/]+)\/prompt_async$/.exec(path))) {
    send(204);
    void turn(m[1], json.parts.map((p) => p.text ?? "").join("\n"));
    return;
  }
  if ((m = /^\/session\/([^/]+)\/abort$/.exec(path))) {
    sessions.get(m[1])?.onAbort?.();
    return send(200, true);
  }
  if ((m = /^\/permission\/([^/]+)\/reply$/.exec(path))) {
    waiting.get(m[1])?.(json.reply);
    waiting.delete(m[1]);
    return send(200, true);
  }
  send(404, { name: "NotFoundError", data: { message: path } });
});
server.listen(0, "127.0.0.1", () => {
  console.log(
    `opencode server listening on http://127.0.0.1:${server.address().port}`,
  );
});
