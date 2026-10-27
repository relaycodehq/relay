#!/usr/bin/env node
// Runs the whole unit suite the way the Mac mini does, in its own session.
// Partway through, something in the suite kills its whole process group, and
// from an agent's shell that group is the shell (exit 137, no output). macOS
// has no setsid command, so the suite gets its session from here instead.
//
//   npm run test:all [-- <extra vitest args>]
import { spawn } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const log = join(tmpdir(), `relay-vitest-${process.pid}.log`);
const out = openSync(log, "w");
console.log(`Unit suite running, output in ${log}`);
const suite = spawn(
  "npx",
  ["vitest", "run", "--maxWorkers=2", ...process.argv.slice(2)],
  { detached: true, stdio: ["ignore", out, out] },
);
suite.on("exit", (code, signal) => {
  process.stdout.write(readFileSync(log));
  if (signal) console.error(`Unit suite ended by ${signal}`);
  process.exit(code ?? 1);
});
