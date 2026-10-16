// Records a real agent CLI for tests/fixtures/replay-agent.cjs: runs the CLI in
// RELAY_REPLAY_REAL with the same arguments and environment, passes its stdio
// through, and writes every line each way to a transcript in RELAY_REPLAY_OUT,
// labelled with the agent in RELAY_REPLAY_AGENT.
// Only tests/record/record-replays.test.ts uses it.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

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
  stream.on("data", (chunk) => {
    sink?.write(chunk);
    rest += chunk.toString("utf8");
    let at;
    while ((at = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, at);
      rest = rest.slice(at + 1);
      if (line.trim()) write({ dir, line });
    }
  });
  stream.on("end", () => {
    if (rest.trim()) write({ dir, line: rest });
  });
};
let stdinEnded = false;
lines(process.stdin, "out", child.stdin);
process.stdin.on("end", () => {
  stdinEnded = true;
  child.stdin.end();
});
lines(child.stdout, "in", process.stdout);
child.stderr.pipe(process.stderr);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  write({ exit: { code, signal, afterStdin: stdinEnded } });
  process.exit(code ?? 1);
});
