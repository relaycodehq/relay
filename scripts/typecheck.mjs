// Type-checks each environment's project (see tsconfig.json) at the same time.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const projects = ["web", "node", "preload", "tests"];
const tsc = fileURLToPath(
  new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);
const runs = projects.map(
  (name) =>
    new Promise((done) => {
      let output = "";
      const child = spawn(
        process.execPath,
        ["--no-warnings", tsc, "-p", `tsconfig.${name}.json`],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      child.on("close", (code) => done({ name, code, output }));
    }),
);
let failed = false;
for (const { name, code, output } of await Promise.all(runs)) {
  if (code === 0) continue;
  failed = true;
  console.error(`tsconfig.${name}.json\n${output}`);
}
process.exit(failed ? 1 : 0);
