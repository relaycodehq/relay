// A stand-in for `opencode serve`: the HTTP API and event stream Relay uses,
// with one scripted turn. Requests are appended to RELAY_OPENCODE_CAPTURE.
const http = require("node:http");
const { appendFileSync, existsSync, writeFileSync } = require("node:fs");

const password = process.env.OPENCODE_SERVER_PASSWORD;
const auth = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
const capture = (entry) => {
  if (process.env.RELAY_OPENCODE_CAPTURE)
    appendFileSync(
      process.env.RELAY_OPENCODE_CAPTURE,
      JSON.stringify(entry) + "\n",
    );
};
/**
 * `opencode models --refresh` fetches a list with one more model; like the
 * real one, the server reads it only as it starts.
 */
const modelsCache = `${process.env.RELAY_OPENCODE_CAPTURE ?? ""}.models`;
if (process.argv[2] === "models") {
  if (process.argv.includes("--refresh") && process.env.RELAY_OPENCODE_CAPTURE)
    writeFileSync(modelsCache, "refreshed");
  console.log("Models cache refreshed");
  process.exit(0);
}
const refreshed = existsSync(modelsCache);
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
/** RELAY_OPENCODE_QUIRK makes the server say something a newer or broken OpenCode might. */
const quirk = process.env.RELAY_OPENCODE_QUIRK;
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
  const say = async (message, parts, text) => {
    const part = {
      id: id("prt"),
      messageID: message.id,
      sessionID,
      type: "text",
      text,
    };
    parts.push(part);
    emit("message.part.updated", { sessionID, part });
    await tick();
  };
  const idle = (message) => {
    message.time.completed = Date.now();
    busy.delete(sessionID);
    emit("session.status", { sessionID, status: { type: "idle" } });
    emit("session.idle", { sessionID });
  };
  // A question for the user; the answer is what it picked, or that it skipped.
  if (text.includes("fixture question")) {
    const question = {
      id: id("que"),
      sessionID,
      questions: [
        {
          question: "Which file?",
          header: "File",
          options: [{ label: "a.ts" }, { label: "b.ts", description: "B" }],
        },
      ],
    };
    const reply = await new Promise((resolve) => {
      waiting.set(question.id, resolve);
      emit("question.asked", question);
    });
    await say(
      first,
      firstParts,
      reply ? `Picked ${reply.flat().join(", ")}.` : "No answer.",
    );
    idle(first);
    return;
  }
  // Works until a steer arrives, then answers it in a message of its own.
  if (text.includes("fixture hold")) {
    await say(first, firstParts, "Working on it.");
    const steer = await new Promise((resolve) => (session.onSteer = resolve));
    delete session.onSteer;
    const asked = {
      id: id("msg"),
      role: "user",
      time: { created: Date.now() },
    };
    session.messages.push({
      info: asked,
      parts: [
        { id: id("prt"), messageID: asked.id, type: "text", text: steer },
      ],
    });
    first.time.completed = Date.now();
    await tick();
    const next = {
      id: id("msg"),
      sessionID,
      role: "assistant",
      time: { created: Date.now() },
    };
    const nextParts = [];
    session.messages.push({ info: next, parts: nextParts });
    emit("message.updated", { sessionID, info: next });
    await say(next, nextParts, `Done with: ${steer}`);
    idle(next);
    return;
  }
  // Goes idle without a word on the event stream.
  if (text.includes("fixture silent idle")) {
    first.time.completed = Date.now();
    busy.delete(sessionID);
    // The text comes last, so a client that has it can trust the status.
    await say(first, firstParts, "Quiet answer.");
    return;
  }
  // The provider stumbles once before the turn gets going.
  if (text.includes("fixture retry")) {
    emit("session.status", {
      sessionID,
      status: { type: "retry", attempt: 1, message: "Overloaded" },
    });
    await tick();
    emit("session.status", { sessionID, status: { type: "busy" } });
  }
  // A turn OpenCode ends in the failure JSON that follows: announced by
  // session.error, or only left on the stored message for the session to read.
  const failing = /fixture (stored )?error: (.*)$/m.exec(text);
  if (failing) {
    first.error = JSON.parse(failing[2]);
    first.time.completed = Date.now();
    if (!failing[1]) emit("session.error", { sessionID, error: first.error });
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
  // A `task` call: its subagent works in a session of its own, which the
  // event stream names by that session's id.
  if (text.includes("fixture task")) {
    const child = { id: id("ses"), directory: session.directory, messages: [] };
    sessions.set(child.id, child);
    const metadata = { sessionId: child.id, parentSessionId: sessionID };
    const input = { description: "Look around", prompt: "Look around." };
    const task = {
      id: id("prt"),
      messageID: first.id,
      sessionID,
      type: "tool",
      tool: "task",
      callID: "call_task",
      state: { status: "running", input, metadata },
    };
    firstParts.push(task);
    emit("message.part.updated", { sessionID, part: task });
    await tick();
    const info = {
      id: id("msg"),
      sessionID: child.id,
      role: "assistant",
      providerID: "zen",
      modelID: "pickle",
      time: { created: Date.now() },
    };
    const childParts = [
      {
        id: id("prt"),
        messageID: info.id,
        sessionID: child.id,
        type: "tool",
        tool: "read",
        callID: "call_child_read",
        state: {
          status: "completed",
          input: { filePath: "/w/a.ts" },
          output: "00001| hello",
        },
      },
      {
        id: id("prt"),
        messageID: info.id,
        sessionID: child.id,
        type: "text",
        text: "The subagent's own notes.",
      },
      {
        id: id("prt"),
        messageID: info.id,
        sessionID: child.id,
        type: "step-finish",
        cost: 0.004,
        tokens: {
          total: 120,
          input: 100,
          output: 20,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
    ];
    child.messages.push({ info, parts: childParts });
    emit("message.updated", { sessionID: child.id, info });
    for (const part of childParts) {
      emit("message.part.updated", { sessionID: child.id, part });
      await tick();
    }
    emit("session.idle", { sessionID: child.id });
    task.state = {
      status: "completed",
      input,
      metadata,
      output: `<task id="${child.id}" state="completed"><task_result>Found a.ts.</task_result></task>`,
    };
    emit("message.part.updated", { sessionID, part: task });
  }
  const note = {
    id: id("prt"),
    messageID: first.id,
    sessionID,
    type: "text",
    text: "",
  };
  firstParts.push(note);
  if (quirk === "newer") {
    emit("session.shiny", { sessionID, news: true });
    emit("message.part.updated", {
      sessionID,
      part: { id: id("prt"), messageID: first.id, type: "hologram", rays: 3 },
    });
    emit("message.part.updated", {
      sessionID,
      part: { ...note, extra: { nested: 1 }, synthetic: null },
    });
  } else if (quirk === "part-without-messageID") {
    const { messageID, ...orphan } = note;
    emit("message.part.updated", { sessionID, part: orphan });
  } else emit("message.part.updated", { sessionID, part: note });
  for (const delta of ["Let me ", "check."]) {
    await tick();
    note.text += delta;
    emit("message.part.delta", {
      sessionID,
      messageID: first.id,
      partID: note.id,
      field: "text",
      ...(quirk === "delta-without-text" ? {} : { delta }),
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
  if (
    quirk === "empty-after-tool" ||
    text.includes("fixture empty after tool")
  ) {
    busy.delete(sessionID);
    emit("session.status", { sessionID, status: { type: "idle" } });
    emit("session.idle", { sessionID });
    return;
  }
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
  if (quirk !== "missing-final-message")
    emit("message.updated", { sessionID, info: second });
  const missingText =
    quirk === "missing-final-message" || quirk === "missing-final-part";
  if (!missingText) emit("message.part.updated", { sessionID, part: answer });
  for (const delta of [
    reply === "reject" ? "Skipped the edit" : "Wrote notes.md",
    ".",
  ]) {
    await tick();
    answer.text += delta;
    if (!missingText)
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
  session.messages.at(-1).parts.push({ ...finish, cost: 0.025 });
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
  if (quirk === "provider-list-without-all" && path === "/provider")
    return send(200, { connected: ["zen"] });
  if (quirk === "model-without-id" && path === "/provider")
    return send(200, {
      all: [{ id: "zen", name: "Zen", models: { pickle: { name: "Pickle" } } }],
      connected: ["zen"],
    });
  if (quirk === "config-not-an-object" && path === "/config")
    return send(200, "nope");
  if (quirk === "command-without-name" && path === "/command")
    return send(200, [{ description: "Create AGENTS.md" }]);
  if (path === "/config") return send(200, { model: "zen/pickle" });
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
            ...(refreshed && {
              wonder: {
                id: "wonder",
                name: "Wonder",
                capabilities: { toolcall: true },
                limit: { context: 200000 },
              },
            }),
          },
        },
      ],
      connected: ["zen", "anthropic"],
    });
  if (path === "/command")
    return send(200, [
      { name: "init", description: "Create AGENTS.md" },
      // OpenCode lists its skills as commands too.
      {
        name: "explain",
        description: "Explain code",
        source: "skill",
        hints: [],
      },
    ]);
  if (path === "/skill")
    return send(200, [
      {
        name: "explain",
        description: "Explain code",
        location: "/project/.opencode/skill/explain/SKILL.md",
        content: "Explain it.",
      },
    ]);
  if (path === "/session/status")
    return send(
      200,
      Object.fromEntries([...busy].map((id) => [id, { type: "busy" }])),
    );
  if (path === "/permission" && req.method === "GET")
    return send(200, [...asked.values()]);
  if (path === "/question" && req.method === "GET") return send(200, []);
  if (path === "/mcp") return send(200, req.method === "GET" ? {} : true);
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
  if (
    (m = /^\/session\/([^/]+)\/message$/.exec(path)) &&
    req.method === "POST"
  ) {
    if (!json.noReply)
      return send(400, { message: "Expected context-only message" });
    const messageID = id("msg");
    const message = {
      info: {
        id: messageID,
        sessionID: m[1],
        role: "user",
        time: { created: Date.now() },
      },
      parts: json.parts.map((part) => ({
        ...part,
        id: id("part"),
        messageID,
        sessionID: m[1],
      })),
    };
    sessions.get(m[1]).messages.push(message);
    emit("message.updated", { sessionID: m[1], info: message.info });
    return send(200, message);
  }
  if ((m = /^\/session\/([^/]+)\/message$/.exec(path)))
    return send(
      200,
      (sessions.get(m[1])?.messages ?? []).map((message) =>
        quirk === "message-without-id"
          ? { ...message, info: { ...message.info, id: undefined } }
          : message,
      ),
    );
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
    const text = json.parts.map((p) => p.text ?? "").join("\n");
    const session = sessions.get(m[1]);
    // Sent while a turn runs, it steers that turn.
    if (session?.onSteer) session.onSteer(text);
    else void turn(m[1], text);
    return;
  }
  if ((m = /^\/session\/([^/]+)\/summarize$/.exec(path))) {
    send(200, true);
    const session = sessions.get(m[1]);
    const sessionID = m[1];
    // Like OpenCode, the compaction is a prompt of its own.
    session.messages.push({
      info: { id: id("msg"), role: "user", time: { created: Date.now() } },
      parts: [],
    });
    const info = {
      id: id("msg"),
      sessionID,
      role: "assistant",
      summary: true,
      time: { created: Date.now() },
    };
    const part = {
      id: id("prt"),
      messageID: info.id,
      sessionID,
      type: "text",
      text: "Summary so far.",
    };
    session.messages.push({ info, parts: [part] });
    busy.add(sessionID);
    emit("session.status", { sessionID, status: { type: "busy" } });
    emit("message.updated", { sessionID, info });
    emit("message.part.updated", { sessionID, part });
    info.time.completed = Date.now();
    busy.delete(sessionID);
    emit("session.status", { sessionID, status: { type: "idle" } });
    emit("session.idle", { sessionID });
    return;
  }
  if ((m = /^\/question\/([^/]+)\/(reply|reject)$/.exec(path))) {
    waiting.get(m[1])?.(m[2] === "reply" ? json.answers : null);
    waiting.delete(m[1]);
    return send(200, true);
  }
  // A command runs as a turn of its own, like the prompt it expands to.
  if ((m = /^\/session\/([^/]+)\/command$/.exec(path))) {
    send(200, {});
    void turn(m[1], `/${json.command} ${json.arguments}`.trim());
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
