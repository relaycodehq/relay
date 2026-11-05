import { basename, dirname, join } from "node:path";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

/**
 * A private copy of the checker's worker in a fresh temporary folder, which
 * the caller removes once the worker exits. Returns the folder.
 */
export async function stageWorker(worker: string) {
  const runtime = await mkdtemp(join(tmpdir(), "relay-checks-"));
  try {
    await writeFile(join(runtime, "worker.mjs"), await readFile(worker), {
      mode: 0o600,
    });
    // Unbundled (tests), worker.mjs imports its worker-*.mjs siblings.
    if (basename(worker) === "worker.mjs")
      for (const name of await readdir(dirname(worker)))
        if (/^worker-.+\.mjs$/.test(name))
          await writeFile(
            join(runtime, name),
            await readFile(join(dirname(worker), name)),
            { mode: 0o600 },
          );
  } catch (e) {
    await rm(runtime, { recursive: true, force: true });
    throw e;
  }
  return runtime;
}

/** Relay's environment without its secrets or the variables that change how Node runs. */
export function workerEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/TOKEN|SECRET|PASSWORD|API_KEY|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH/i.test(
          key,
        ),
    ),
  );
}
