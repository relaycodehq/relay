import { afterEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { lockPath } from "./lock";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

it("publishes a complete owner and never steals a live lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-lock-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "installation");
  const release = await lockPath(path);
  cleanup.push(release);
  await expect(lockPath(path)).rejects.toMatchObject({ code: "ELOCKED" });
  await release();
  const next = await lockPath(path);
  await next();
});

it("serializes independent processes competing to recover a dead owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-lock-race-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "installation");
  await mkdir(`${path}.lock`);
  await writeFile(
    join(`${path}.lock`, "2147483647-00000000-0000-0000-0000-000000000000"),
    "",
  );
  const { outputFiles } = await build({
    entryPoints: ["electron/headless/lock.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const script =
    outputFiles![0]!.text +
    `
    module.exports.lockPath(process.argv[1]).then(release => {
      process.send('owned');
      process.on('message', async () => { await release(); process.exit(0); });
    }, e => { process.send(e.code); process.exit(0); });
  `;
  const children = Array.from({ length: 8 }, () =>
    spawn(process.execPath, ["-e", script, path], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  );
  cleanup.push(async () => {
    for (const child of children) if (child.exitCode === null) child.kill();
  });
  const results = await Promise.all(
    children.map(
      (child) =>
        new Promise<unknown>((resolve, reject) => {
          child.once("message", resolve);
          child.once("error", reject);
          child.once("exit", () =>
            reject(new Error("Contender exited before reporting.")),
          );
        }),
    ),
  );
  expect(results.filter((result) => result === "owned")).toHaveLength(1);
  expect(results.filter((result) => result === "ELOCKED")).toHaveLength(7);
  const winner = children[results.indexOf("owned")]!;
  const exited = new Promise((resolve) => winner.once("exit", resolve));
  winner.send("release");
  await exited;
  const release = await lockPath(path);
  await release();
});
