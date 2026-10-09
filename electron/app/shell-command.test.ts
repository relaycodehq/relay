import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

/** Runs the shim in `cwd`; the app and headless Relay write down what they were given. */
function relay(cwd: string, args: string[], { headless = true } = {}) {
  const app = join(dir, "Relay App");
  script(app, `printf '%s\\n' "$@" > "${dir}/app.log"`);
  const install = join(dir, "install");
  mkdirSync(join(install, "bin"), { recursive: true });
  rmSync(join(install, "bin", "relay"), { force: true });
  if (headless) script(join(install, "bin", "relay"), `printf '%s\\n' "$@"`);
  const shim = join(dir, "relay");
  script(
    shim,
    shimScript("linux", "dev.relay.experimental", app).replace(/^#!.*\n/, ""),
  );
  rmSync(join(dir, "app.log"), { force: true });
  const run = spawnSync(shim, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, RELAY_INSTALL: install },
  });
  // The app is launched in the background.
  for (let i = 0; i < 50 && run.status === 0; i++) {
    try {
      return { ...run, app: readFileSync(join(dir, "app.log"), "utf8") };
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  return { ...run, app: undefined };
}

it("opens a folder in the app by its full path", () => {
  const project = join(dir, "my project");
  mkdirSync(join(project, "src"), { recursive: true });
  expect(relay(join(project, "src"), [".."]).app).toBe(`${project}\n`);
});

it("hands commands to the headless Relay, even with a folder of that name", () => {
  mkdirSync(join(dir, "logs"));
  const run = relay(dir, ["logs", "-f"]);
  expect(run.stdout).toBe("logs\n-f\n");
  expect(run.app).toBeUndefined();
  // Proving the app stayed shut waits out the whole poll.
}, 10000);

it("says how to install the headless Relay when it isn't", () => {
  const run = relay(dir, ["status"], { headless: false });
  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(/install\.sh \| sh/);
});
