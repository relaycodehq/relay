// Plays a transcript recorded from a real agent CLI (see replay-tee.cjs and
// tests/fixtures/replays/README.md) as that CLI: every line Relay sent then is
// waited for before what the agent said after it goes out, so a replay runs on
// what Relay does, not on time.
//
// A scenario holds one transcript per process the agent ran: Relay starts a
// CLI for the thread's turns, for helper jobs such as titles, and to read its
// models. The arguments tell some apart; where they're the same (OpenCode's
// `acp`), a process plays the first transcript until what Relay sends fits
// another one better, then carries on in that one.
//
// RELAY_REPLAY_AGENT  which agent this stand-in plays: claude, codex, opencode…
// RELAY_REPLAY_DIR    the scenario's transcripts
// RELAY_REPLAY_FAULT  "exit": exit 1 instead of the line that ends the last
//                     turn; "close": end the stream there and exit 0
// RELAY_REPLAY_GAP_MS the longest pause kept from the recording (300ms): an
//                     agent that went quiet for a while, then started a turn
//                     by itself, does so after a pause here too
const fs = require("node:fs");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");

const agent = process.env.RELAY_REPLAY_AGENT;
const dir = process.env.RELAY_REPLAY_DIR;
const fault = process.env.RELAY_REPLAY_FAULT;
const gapMs = Number(process.env.RELAY_REPLAY_GAP_MS ?? 300);
if (!agent || !dir) {
  process.stderr.write("replay-agent: RELAY_REPLAY_AGENT and RELAY_REPLAY_DIR are required\n");
  process.exit(2);
}

/** A line as JSON, or as text for a CLI fed a plain prompt. */
const parse = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return { type: "text", text: line };
  }
};
// Inside JSON, so a Windows path's backslashes stay escaped.
const here = (text) =>
  text
    .replaceAll("{{project}}", JSON.stringify(process.cwd()).slice(1, -1))
    .replaceAll("{{home}}", "/home/replay");

/** What a process was started for, as far as its arguments say. */
function roleOf(args) {
  if (args.includes("--permission-prompt-tool")) return "turn";
  if (args.includes("--print") || args.includes("-p")) return "print";
  if (args.includes("--chrome")) return "chrome";
  // Codex is one app-server either way; what it's told with -c says what for.
  // Muse's helpers are a `serve` like its turns, with --no-session-log.
  const sub = args[0] && !args[0].startsWith("-") ? args[0] : "";
  const config = args.flatMap((a, i) => (args[i - 1] === "-c" ? [a.split("=")[0]] : []));
  const flags = args.filter((a) => a.startsWith("--")).map((a) => a.split("=")[0]);
  return `run:${sub}:${config.sort().join(",")}:${flags.sort().join(",")}`;
}

/** What kind of line it is, the same however Relay numbered it. */
function keyOf(m) {
  if (typeof m.method === "string") return `rpc:${m.method}`;
  if ("id" in m && ("result" in m || "error" in m)) return "rpc:response";
  if (m.type === "control_request") return `control:${m.request?.subtype}`;
  if (m.type === "control_response") return "control:response";
  return `line:${m.type}`;
}
const requestId = (m) =>
  m.type === "control_request" ? m.request_id : typeof m.method === "string" ? m.id : undefined;

const role = roleOf(process.argv.slice(2));
const candidates = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".jsonl"))
  .sort()
  .map((file) => {
    const [first, ...rest] = fs
      .readFileSync(path.join(dir, file), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const entries = rest.map((e) =>
      e.line === undefined ? e : { ...e, message: parse(here(e.line)) },
    );
    return { meta: first.meta, entries, last: entries.findLastIndex((x, i) => endsTurn(entries, x, i)) };
  })
  .filter(({ meta }) => meta.agent === agent && roleOf(meta.args) === role)
  // Ones that answer a prompt first: a process that hasn't said what it's for
  // yet is more likely a turn than a probe.
  .sort((a, b) => ends(b.entries) - ends(a.entries));
if (!candidates.length) {
  process.stderr.write(`replay-agent: no ${role} transcript for ${agent}\n`);
  process.exit(2);
}
function ends(entries) {
  return entries.filter((e, i) => endsTurn(entries, e, i)).length;
}
/** The line that ends a turn: Claude's result, Codex's turn/completed, an ACP prompt's answer. */
function endsTurn(entries, e, i) {
  if (e.dir !== "in") return false;
  const key = keyOf(e.message);
  if (key === "line:result" || key === "rpc:turn/completed") return true;
  if (key !== "rpc:response") return false;
  const request = entries
    .slice(0, i)
    .findLast((x) => x.dir === "out" && requestId(x.message) === e.message.id);
  return request?.message.method === "session/prompt";
}

let current = candidates[0];
let at = 0;
/** Lines Relay sent that a transcript took so far, and the agent's lines as they went out. */
let outs = 0;
const emitted = [];
/** Values the transcript recorded to the ones already sent, e.g. a session id. */
const same = new Map();
/** Recorded request ids to the ones Relay used this time. */
const ids = new Map();
/** The answer each kind of request got last, for one Relay asks again. */
const answers = new Map();
const sent = [];
let waiting;
let stdinEnded = false;

const emit = (m, recorded = false) => {
  if (recorded) emitted.push(m);
  process.stdout.write(
    (m.type === "text" && typeof m.text === "string" ? m.text : JSON.stringify(m)) + "\n",
  );
};
const wake = () => waiting?.();

/** Pairs what `recorded` and `shown` hold in the same place, where they differ. */
function pairValues(recorded, shown) {
  if (typeof recorded === "string" && typeof shown === "string") {
    if (recorded !== shown && recorded.length >= 8) same.set(recorded, shown);
  } else if (recorded && shown && typeof recorded === "object" && typeof shown === "object")
    for (const key of Object.keys(recorded)) pairValues(recorded[key], shown[key]);
}
function sameAsShown(value) {
  if (typeof value === "string") {
    let out = value;
    for (const [recorded, shown] of same) out = out.replaceAll(recorded, shown);
    return out;
  }
  if (Array.isArray(value)) return value.map(sameAsShown);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sameAsShown(v)]));
  return value;
}

/** The index of the `n`th line Relay sent in `entries`. */
function nthOut(entries, n) {
  for (let i = 0, seen = 0; i < entries.length; i++)
    if (entries[i].dir === "out" && seen++ === n) return i;
  return -1;
}
/**
 * Moves to the transcript whose next line from Relay is `m`, as the same
 * process would have gone on there. Its earlier lines from the agent stand
 * for the ones already sent, values and all.
 */
function switchFor(m) {
  for (const other of candidates) {
    if (other === current) continue;
    const i = nthOut(other.entries, outs);
    if (i < 0 || keyOf(other.entries[i].message) !== keyOf(m)) continue;
    const earlier = other.entries.slice(0, i).filter((e) => e.dir === "in");
    earlier.forEach((e, n) => emitted[n] && pairValues(e.message, emitted[n]));
    current = other;
    at = i;
    return true;
  }
  return false;
}

const expected = () =>
  new Set(current.entries.slice(at).filter((e) => e.dir === "out").map((e) => keyOf(e.message)));
function answerUnexpected(m) {
  const id = requestId(m);
  process.stderr.write(`replay: unexpected ${keyOf(m)}\n`);
  if (id === undefined) return;
  const known = answers.get(keyOf(m));
  if (m.type === "control_request")
    return emit({
      type: "control_response",
      response: known
        ? { ...known.response, request_id: id }
        : { subtype: "error", request_id: id, error: `replay: unexpected ${m.request?.subtype}` },
    });
  emit(
    known
      ? { ...known, id }
      : { id, error: { code: -32601, message: `replay: unexpected ${m.method}` } },
  );
}
function heard(m) {
  const next = current.entries[nthOut(current.entries, outs + sent.length)];
  // Relay's next line, or another transcript's: this process is that one.
  // Otherwise one further on, sent a little early.
  const fits =
    (next && keyOf(next.message) === keyOf(m)) || switchFor(m) || expected().has(keyOf(m));
  if (!fits) return answerUnexpected(m);
  sent.push(m);
  wake();
}

let rest = "";
const decoder = new StringDecoder("utf8");
process.stdin.on("data", (chunk) => {
  rest += decoder.write(chunk);
  let i;
  while ((i = rest.indexOf("\n")) >= 0) {
    const line = rest.slice(0, i);
    rest = rest.slice(i + 1);
    if (line.trim()) heard(parse(line));
  }
});
process.stdin.on("end", () => {
  rest += decoder.end();
  if (rest.trim()) heard(parse(rest));
  stdinEnded = true;
  wake();
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const take = (key) => {
  const i = sent.findIndex((m) => keyOf(m) === key);
  return i < 0 ? undefined : sent.splice(i, 1)[0];
};
/** The recorded request a response answers, before index `i`. */
const requestFor = (entries, i, id) =>
  entries.slice(0, i).findLast((x) => x.dir === "out" && requestId(x.message) === id);

async function play() {
  for (; at < current.entries.length; at++) {
    const { entries } = current;
    const e = entries[at];
    if (e.dir === "out") {
      const key = keyOf(e.message);
      let m;
      while (!(m = take(key))) {
        if (stdinEnded) process.exit(0);
        const before = current;
        await new Promise((done) => (waiting = done));
        // Moved to another transcript meanwhile: carry on from its place there.
        if (current !== before) {
          at--;
          break;
        }
      }
      if (!m) continue;
      outs++;
      const id = requestId(e.message);
      if (id !== undefined) ids.set(JSON.stringify(id), requestId(m));
      continue;
    }
    if (e.dir === "in") {
      const previous = entries[at - 1];
      if (previous?.dir === "in" && e.t - previous.t > 1000)
        await sleep(Math.min(e.t - previous.t, gapMs));
      if (at === current.last && fault === "exit") process.exit(1);
      if (at === current.last && fault === "close") {
        process.stdout.end();
        return process.exit(0);
      }
      const m = sameAsShown(structuredClone(e.message));
      if (keyOf(m) === "rpc:response") {
        m.id = ids.get(JSON.stringify(m.id)) ?? m.id;
        const request = requestFor(entries, at, e.message.id);
        if (request) answers.set(keyOf(request.message), e.message);
      }
      if (m.type === "control_response" && m.response?.request_id !== undefined) {
        const recorded = m.response.request_id;
        const request = requestFor(entries, at, recorded);
        if (request) answers.set(keyOf(request.message), e.message);
        m.response.request_id = ids.get(JSON.stringify(recorded)) ?? recorded;
      }
      emit(m, true);
      continue;
    }
    if (e.exit) {
      // The CLI quit because Relay closed its input, or by itself.
      if (e.exit.afterStdin)
        while (!stdinEnded) await new Promise((done) => (waiting = done));
      process.exit(e.exit.code ?? 0);
    }
  }
  // Out of transcript: answer what's asked from what was answered before.
  waiting = () => {
    for (const m of sent.splice(0)) answerUnexpected(m);
    if (stdinEnded) process.exit(0);
  };
  waiting();
}
void play();
