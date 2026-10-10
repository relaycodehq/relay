import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({ app: {}, dialog: {} }));
const { shimScript } = await import("./shell-command");

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "relay-shim-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const script = (path: string, body: string) => {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};

/** FD 3 stays open until the background app exits, so close covers either route. */
async function relay(cwd: string, args: string[], { headless = true } = {}) {
  const app = join(dir, "Relay App");
  script(app, `printf '%s\\n' "$@" >&3`);
  const install = join(dir, "install");
  mkdirSync(join(install, "bin"), { recursive: true });
  rmSync(join(install, "bin", "relay"), { force: true });
  if (headless) script(join(install, "bin", "relay"), `printf '%s\\n' "$@"`);
  const shim = join(dir, "relay");
  script(
    shim,
    shimScript("linux", "dev.relay.experimental", app).replace(/^#!.*\n/, ""),
  );
  const run = spawn(shim, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe", "pipe"],
    env: { ...process.env, RELAY_INSTALL: install },
  });
  let stdout = "";
  let stderr = "";
  let opened: string | undefined;
  run.stdout!.on("data", (chunk) => (stdout += chunk));
  run.stderr!.on("data", (chunk) => (stderr += chunk));
  run.stdio[3]!.on("data", (chunk) => (opened = (opened ?? "") + chunk));
  const status = await new Promise<number | null>((resolve, reject) => {
    run.once("error", reject);
    run.once("close", resolve);
  });
  return { status, stdout, stderr, app: opened };
}

it("opens a folder in the app by its full path", async () => {
  const project = join(dir, "my project");
  mkdirSync(join(project, "src"), { recursive: true });
  expect((await relay(join(project, "src"), [".."])).app).toBe(`${project}\n`);
});

it("hands commands to the headless Relay, even with a folder of that name", async () => {
  mkdirSync(join(dir, "logs"));
  const run = await relay(dir, ["logs", "-f"]);
  expect(run.stdout).toBe("logs\n-f\n");
  expect(run.app).toBeUndefined();
});

it("says how to install the headless Relay when it isn't", async () => {
  const run = await relay(dir, ["status"], { headless: false });
  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(/install\.sh \| sh/);
});
