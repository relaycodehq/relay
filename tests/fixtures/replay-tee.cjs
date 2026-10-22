// Records a real agent CLI for tests/fixtures/replay-agent.cjs: runs the CLI in
// RELAY_REPLAY_REAL with the same arguments and environment, passes its stdio
// through, and writes every line each way to a transcript in RELAY_REPLAY_OUT,
// labelled with the agent in RELAY_REPLAY_AGENT.
// With RELAY_REPLAY_PROXY, `opencode service status` points Relay at that
// recording proxy instead of the service (tests/record/opencode-proxy.ts),
// and `opencode service get password` is written down as a placeholder.
// Only tests/record/record-replays.test.ts uses it.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");

const real = process.env.RELAY_REPLAY_REAL;
const outDir = process.env.RELAY_REPLAY_OUT;
if (!real || !outDir) {
  process.stderr.write("replay-tee: RELAY_REPLAY_REAL and RELAY_REPLAY_OUT are required\n");
  process.exit(2);
}
const args = process.argv.slice(2);
const started = Date.now();
const file = path.join(outDir, `${started}-${process.pid}.jsonl`);
const write = (entry) =>
  fs.appendFileSync(file, JSON.stringify({ t: Date.now() - started, ...entry }) + "\n");
write({
  meta: {
    agent: process.env.RELAY_REPLAY_AGENT,
    version: process.env.RELAY_REPLAY_VERSION,
    args,
    cwd: process.cwd(),
  },
});

const child = spawn(real, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
const lines = (stream, dir, sink) => {
  let rest = "";
  const decoder = new StringDecoder("utf8");
  stream.on("data", (chunk) => {
    sink?.write(chunk);
    rest += decoder.write(chunk);
    let at;
    while ((at = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, at);
      rest = rest.slice(at + 1);
      if (line.trim()) write({ dir, line });
    }
  });
  stream.on("end", () => {
    rest += decoder.end();
    if (rest.trim()) write({ dir, line: rest });
  });
};
let stdinEnded = false;
lines(process.stdin, "out", child.stdin);
process.stdin.on("end", () => {
  stdinEnded = true;
  child.stdin.end();
});
const proxy = process.env.RELAY_REPLAY_PROXY;
const asked = args.filter((a) => !a.startsWith("-")).join(" ");
if (proxy && asked === "service status") {
  // Answered whole once it exits: the address goes to the proxy, Relay gets the proxy's.
  let said = "";
  child.stdout.on("data", (chunk) => (said += chunk));
  child.stdout.on("end", async () => {
    const address = said.match(/http:\/\/[^\s]+/)?.[0];
    if (address)
      await fetch(proxy + "/__relay_record_target", { method: "POST", body: address });
    if (said.trim()) write({ dir: "in", line: address ? said.trim().replace(address, "{{service}}") : said.trim() });
    process.stdout.write(address ? said.replace(address, proxy) : said);
    ended();
  });
} else if (proxy && asked === "service get password") {
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stdout.on("end", () => {
    write({ dir: "in", line: "{{password}}" });
    ended();
  });
} else {
  lines(child.stdout, "in", process.stdout);
  child.stdout.on("end", () => ended());
}
child.stderr.pipe(process.stderr);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
// Exits once the child has, and all it said is passed on and written down.
let exited;
let outputDone = false;
function ended() {
  outputDone = true;
  finish();
}
function finish() {
  if (!exited || !outputDone) return;
  const { code, signal } = exited;
  write({ exit: { code, signal, afterStdin: stdinEnded } });
  process.exit(code ?? 1);
}
child.on("exit", (code, signal) => {
  exited = { code, signal };
  finish();
});
