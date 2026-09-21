import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const evaluation = process.argv[2] ?? "generic";
if (!["generic", "feature"].includes(evaluation))
  throw new Error("Choose the generic or feature grouping evaluation.");
const dir = await mkdtemp(join(tmpdir(), "relay-live-eval-"));
try {
  const outfile = join(dir, "eval.mjs");
  await build({
    entryPoints: [`tests/evals/${evaluation}-grouping.ts`],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [outfile], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
} finally {
  await rm(dir, { recursive: true, force: true });
}
