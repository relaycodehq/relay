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
    parent.postMessage({ type: "replied" });
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
    const notice = (type: string) =>
      new Promise<void>((resolve) => {
        const listen = (message: { type?: string }) => {
          if (message.type !== type) return;
          worker.off("message", listen);
          resolve();
        };
        worker.on("message", listen);
      });
    const ready = notice("ready");
    const replied = notice("replied");
    const closed = notice("closed");
    const { port1, port2 } = new HeadlessMessageChannel();
    worker.postMessage({ type: "port" }, [port1]);
    const replies: { sum: number; samples: Float32Array; isFloat: boolean }[] =
      [];
    port2.on("message", ({ data }) => replies.push(data));
    const reply = new Promise<{
      sum: number;
      samples: Float32Array;
      isFloat: boolean;
    }>((resolve) => port2.once("message", ({ data }) => resolve(data)));
    // Held until started, as Electron's are.
    port2.postMessage({ samples: new Float32Array([0.5, 0.25]) });
    await ready;
    // The worker sent the reply before this acknowledgement over the same IPC channel.
    await replied;
    expect(replies).toEqual([]);
    port2.start();
    await reply;
    expect(replies).toHaveLength(1);
    expect(replies[0]!.sum).toBe(0.75);
    expect(replies[0]!.isFloat).toBe(true);
    expect(replies[0]!.samples).toBeInstanceOf(Float32Array);
    expect(notices).toContainEqual({ type: "ready" });

    port2.close();
    await closed;
    const exited = new Promise((r) => worker.once("exit", r));
    worker.kill();
    await exited;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
