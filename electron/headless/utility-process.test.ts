import { expect, it } from "vitest";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import {
  HeadlessMessageChannel,
  HeadlessUtilityProcess,
} from "./utility-process";

/** A worker that answers on the port it's given, as the speech workers do. */
const workerSource = `
import "${join(__dirname, "worker-port.ts").replace(/\\/g, "/")}";
const parent = process.parentPort;
parent.on("message", ({ data, ports }) => {
  if (data.type !== "port") return;
  const port = ports[0];
  port.on("message", ({ data }) => {
    const sum = data.samples.reduce((a, b) => a + b, 0);
    port.postMessage({ sum, samples: data.samples, isFloat: data.samples instanceof Float32Array });
  });
  port.on("close", () => parent.postMessage({ type: "closed" }));
  port.start();
  parent.postMessage({ type: "ready" });
});
`;

it("runs a worker over Node's IPC with Electron's ports, typed arrays intact", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-worker-")));
  try {
    await writeFile(join(dir, "worker.ts"), workerSource);
    await build({
      entryPoints: [join(dir, "worker.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: join(dir, "worker.cjs"),
      logLevel: "silent",
    });
    const worker = new HeadlessUtilityProcess(join(dir, "worker.cjs"));
    const notices: unknown[] = [];
    worker.on("message", (notice) => notices.push(notice));
    const { port1, port2 } = new HeadlessMessageChannel();
    worker.postMessage({ type: "port" }, [port1]);
    const replies: { sum: number; samples: Float32Array; isFloat: boolean }[] =
      [];
    port2.on("message", ({ data }) => replies.push(data));
    // Held until started, as Electron's are.
    port2.postMessage({ samples: new Float32Array([0.5, 0.25]) });
    await new Promise((r) => setTimeout(r, 300));
    expect(replies).toEqual([]);
    port2.start();
    await expect.poll(() => replies.length, { timeout: 5000 }).toBe(1);
    expect(replies[0]!.sum).toBe(0.75);
    expect(replies[0]!.isFloat).toBe(true);
    expect(replies[0]!.samples).toBeInstanceOf(Float32Array);
    expect(notices).toContainEqual({ type: "ready" });

    port2.close();
    await expect.poll(() => notices).toContainEqual({ type: "closed" });
    const exited = new Promise((r) => worker.once("exit", r));
    worker.kill();
    await exited;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
