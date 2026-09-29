// The detached process agent sessions run in. Relay starts it on first use
// and reconnects after a restart; it outlives Relay by design, so it keeps
// each session's log until Relay reads it, and exits once nobody needs it.
import { createServer, type Socket } from "node:net";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  protocolVersion,
  readLines,
  writeLine,
  type ClientMessage,
  type HostMessage,
  type HostRecord,
} from "./protocol";
import {
  ClaudeSession,
  ProcessSession,
  type HostSession,
  type SessionHost,
} from "./sessions";

// Started as Node by Electron's own binary; the agents' commands must not inherit that.
delete process.env.ELECTRON_RUN_AS_NODE;

const flag = process.argv.indexOf("--relay-agent-host");
const dir = process.argv[flag + 1];
if (flag < 0 || !dir) {
  console.error("Usage: agent-host --relay-agent-host <registry folder>");
  process.exit(2);
}
mkdirSync(dir, { recursive: true, mode: 0o700 });
process.chdir(dir);
const version = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex")
  .slice(0, 16);
const logFile = join(dir, `host-${process.pid}.log`);
function log(line: string) {
  try {
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

/** Idle limits: without Relay, a host with nothing to do doesn't linger. */
const limits = {
  idle: 10 * 60_000,
  orphaned: 12 * 60 * 60_000,
};

type Ask = {
  session: string;
  name: "canUseTool" | "hook";
  args: unknown[];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
const sessions = new Map<string, HostSession>();
const asks = new Map<number, Ask>();
let nextAsk = 1;
let client: Socket | undefined;
let lastClient = Date.now();
let draining = false;

function send(message: HostMessage) {
  if (client) writeLine(client, message);
}

const host: SessionHost = {
  deliver(session, entry) {
    if (session.attached && client)
      send({ t: "entry", session: session.id, entry });
  },
  ask(session, name, args, options) {
    // A hook can't wait for a Relay that isn't there; a permission can.
    if (options.timeout !== undefined && !(client && session.attached))
      return Promise.resolve(options.fallback);
    return new Promise<unknown>((resolve, reject) => {
      const id = nextAsk++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = () => {
        asks.delete(id);
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        settle();
        send({ t: "cancel", id });
        resolve(options.fallback);
      };
      asks.set(id, {
        session: session.id,
        name,
        args,
        resolve: (value) => {
          settle();
          resolve(value);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      });
      if (options.signal?.aborted) return cancel();
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.timeout !== undefined)
        timer = setTimeout(cancel, options.timeout);
      if (client && session.attached)
        send({ t: "ask", id, session: session.id, name, args });
    });
  },
  asking: (session) => [...asks.values()].some((a) => a.session === session.id),
};

function open(message: Extract<ClientMessage, { t: "open" }>) {
  if (draining) throw new Error("This agent host is closing.");
  if (sessions.has(message.session))
    throw new Error("That session is already open.");
  const { session: id, key, meta } = message;
  let session: HostSession;
  if (message.process) {
    const running = new ProcessSession(id, key, meta, host);
    running.attached = true;
    running.launch(message.process);
    session = running;
  } else {
    const running = new ClaudeSession(id, key, meta, host);
    running.attached = true;
    running.launch(message.options, message.hooks, message.canUseTool);
    session = running;
  }
  sessions.set(id, session);
  log(`open ${session.kind} ${id}`);
}

function closeSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.close();
  for (const [askId, pending] of asks)
    if (pending.session === id) {
      asks.delete(askId);
      pending.resolve(undefined);
    }
  log(`close ${id}`);
}

function receive(socket: Socket, message: ClientMessage) {
  if (message.t === "hello") return;
  if (socket !== client) return socket.destroy();
  switch (message.t) {
    case "open":
      try {
        open(message);
      } catch (error) {
        send({
          t: "entry",
          session: message.session,
          entry: {
            seq: 0,
            kind: "end",
            failure: error instanceof Error ? error.message : String(error),
          },
        });
      }
      return;
    case "attach": {
      const session = sessions.get(message.session);
      if (!session) {
        send({
          t: "entry",
          session: message.session,
          entry: { seq: 0, kind: "end", failure: "The session has ended." },
        });
        return send({ t: "attached", session: message.session });
      }
      session.attached = true;
      for (const entry of session.entries)
        send({ t: "entry", session: session.id, entry });
      send({ t: "attached", session: session.id });
      for (const [id, pending] of asks)
        if (pending.session === session.id)
          send({
            t: "ask",
            id,
            session: session.id,
            name: pending.name,
            args: pending.args,
          });
      return;
    }
    case "push":
      sessions.get(message.session)?.push(message.message);
      return;
    case "mark":
      sessions
        .get(message.session)
        ?.mark(message.mark, message.at, message.turn);
      return;
    case "meta": {
      const session = sessions.get(message.session);
      if (session) session.meta = message.meta;
      return;
    }
    case "call": {
      const session = sessions.get(message.session);
      void (
        session
          ? session.call(message.method, message.args)
          : Promise.reject(new Error("The session has ended."))
      ).then(
        (value) => send({ t: "return", id: message.id, value }),
        (error) =>
          send({
            t: "return",
            id: message.id,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
      return;
    }
    case "answer": {
      const pending = asks.get(message.id);
      if (!pending) return;
      if (message.error !== undefined) pending.reject(new Error(message.error));
      else pending.resolve(message.value);
      return;
    }
    case "abort":
      sessions.get(message.session)?.abort();
      return;
    case "close":
      closeSession(message.session);
      return;
    case "drain":
      draining = true;
      log("draining");
      return settle();
  }
}

/** Only the owner of the token in Relay's own data folder gets in; the newest wins. */
function greet(socket: Socket, message: ClientMessage) {
  const given = Buffer.from(
    message.t === "hello" && typeof message.token === "string"
      ? message.token
      : "",
  );
  const expected = Buffer.from(token);
  if (
    message.t !== "hello" ||
    given.length !== expected.length ||
    !timingSafeEqual(given, expected)
  )
    return socket.destroy();
  if (message.protocol !== protocolVersion) {
    writeLine(socket, {
      t: "refused",
      error: `This agent host speaks protocol ${protocolVersion}.`,
    } satisfies HostMessage);
    return socket.end();
  }
  const previous = client;
  client = socket;
  if (previous && previous !== socket) previous.destroy();
  for (const session of sessions.values()) session.attached = false;
  send({
    t: "welcome",
    version,
    pid: process.pid,
    sessions: [...sessions.values()].map((s) => s.info()),
  });
  log("client connected");
}

const token = randomBytes(24).toString("hex");
// A folder only this user can enter; Linux prefers its per-user runtime dir.
const socketDir =
  process.platform === "win32"
    ? undefined
    : mkdtempSync(
        join(
          (process.platform === "linux" && process.env.XDG_RUNTIME_DIR) ||
            tmpdir(),
          "relay-",
        ),
      );
const socketPath = socketDir
  ? join(socketDir, "host.sock")
  : `\\\\.\\pipe\\relay-agent-host-${randomBytes(8).toString("hex")}`;
const recordFile = join(dir, `host-${process.pid}.json`);

const server = createServer((socket) => {
  let greeted = false;
  socket.on("error", () => {});
  socket.on("close", () => {
    if (socket !== client) return;
    client = undefined;
    lastClient = Date.now();
    for (const session of sessions.values()) session.attached = false;
    log("client left");
    settle();
  });
  readLines(socket, (message: ClientMessage) => {
    if (!greeted) {
      greeted = true;
      return greet(socket, message);
    }
    receive(socket, message);
  });
});

function shutdown(reason: string) {
  log(`exit: ${reason}`);
  for (const id of [...sessions.keys()]) closeSession(id);
  try {
    rmSync(recordFile, { force: true });
    if (socketDir) rmSync(socketDir, { recursive: true, force: true });
  } catch {}
  process.exit(0);
}

function settle() {
  if (draining && !sessions.size) return shutdown("drained");
  if (client) return;
  const away = Date.now() - lastClient;
  const working = [...sessions.values()].some((s) => s.working());
  // Relay starts a host again whenever it needs one.
  if (!sessions.size) shutdown("no sessions");
  else if (!working && away > limits.idle) shutdown("idle without Relay");
  else if (away > limits.orphaned) shutdown("Relay never came back");
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
// Detached, but a terminal that started it may still hang up.
process.on("SIGHUP", () => {});
process.on("uncaughtException", (error) =>
  log(`uncaught: ${error.stack ?? error.message}`),
);
process.on("unhandledRejection", (error) =>
  log(`unhandled: ${error instanceof Error ? error.stack : String(error)}`),
);

try {
  if (statSync(logFile).size > 1 << 20) rmSync(logFile);
} catch {}
server.listen(socketPath, () => {
  const record: HostRecord = {
    pid: process.pid,
    socket: socketPath,
    token,
    version,
    protocol: protocolVersion,
    started: Date.now(),
  };
  const temp = `${recordFile}.tmp`;
  writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
  renameSync(temp, recordFile);
  log(`listening, version ${version}`);
});
setInterval(settle, 15_000).unref();
