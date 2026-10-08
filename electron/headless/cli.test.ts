import { afterEach, beforeAll, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { serveControl, type ControlApi } from "./control";
import { controlSocket } from "./paths";

const run = promisify(execFile);
let bundled: string;
const cleanup: (() => Promise<unknown>)[] = [];
beforeAll(async () => {
  const result = await build({
    entryPoints: ["electron/headless/cli.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    alias: { electron: "./electron/headless/electron-stand-in.ts" },
    define: { "process.env.RELAY_HEADLESS_VERSION": '"1.0.0"' },
  });
  bundled = result.outputFiles![0]!.text;
});
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-cli-test-")));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "relay"),
    home = join(dir, "home");
  await mkdir(join(root, "lib"), { recursive: true });
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "VERSION"), "1.0.0");
  await writeFile(join(root, "bin", "relay"), "// fixture");
  const cli = join(root, "lib", "relay.cjs");
  await writeFile(cli, bundled);
  return { cli, home };
}

it("rejects an empty explicit home instead of writing into the current folder", async () => {
  const { cli } = await fixture();
  await expect(
    run(process.execPath, [cli, "status", "--home="]),
  ).rejects.toMatchObject({
    code: 2,
    stderr: expect.stringContaining("nonempty path"),
  });
});

it("routes CLI update checks and installs through the running daemon", async () => {
  const { cli, home } = await fixture();
  const calls: boolean[] = [];
  const server = await serveControl(controlSocket(home), {
    status: async () => ({ pid: process.pid }),
    update: async (check: boolean) => {
      calls.push(check);
      return check
        ? {
            status: "available",
            current: "1.0.0",
            version: "2.0.0",
            install: "auto",
          }
        : { status: "installing", current: "1.0.0", version: "2.0.0" };
    },
  } as unknown as ControlApi);
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const checked = await run(process.execPath, [
    cli,
    "update",
    "--check",
    "--json",
    "--home",
    home,
  ]);
  expect(JSON.parse(checked.stdout)).toMatchObject({ status: "available" });
  const installed = await run(process.execPath, [
    cli,
    "update",
    "--json",
    "--home",
    home,
  ]);
  expect(JSON.parse(installed.stdout)).toMatchObject({ status: "installing" });
  expect(calls).toEqual([true, false]);
});

it("rejects a following flag as a missing option value before connecting", async () => {
  const { cli } = await fixture();
  for (const option of ["--home", "--name", "--project", "--port", "--lines"]) {
    await expect(
      run(process.execPath, [cli, "status", option, "--json"]),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining(`${option} needs a value`),
    });
  }
  const result = await run(process.execPath, [cli, "--name=-server", "--help"]);
  expect(result.stdout).toContain("Options");
});
