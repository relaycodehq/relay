import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  home: "",
  commands: [] as string[][],
  failRestart: false,
  noUserManager: false,
  failBootstrap: false,
}));

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => mock.home,
}));

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: (
    file: string,
    args: string[],
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    mock.commands.push([file, ...args]);
    if (mock.failBootstrap && args[0] === "bootstrap")
      return callback(new Error("Bootstrap failed: 5"), "", "");
    if (mock.noUserManager && file === "systemctl")
      return callback(
        Object.assign(new Error("Command failed"), {
          stderr: "Failed to connect to bus: No medium found",
        }),
        "",
        "",
      );
    callback(
      mock.failRestart && args.includes("restart")
        ? new Error("restart failed")
        : null,
      "",
      "",
    );
  },
}));

import {
  installService,
  installedService,
  serviceFile,
  systemdService,
} from "./service";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

afterEach(async () => {
  Object.defineProperty(process, "platform", platform);
  if (mock.home) await rm(mock.home, { recursive: true, force: true });
  mock.home = "";
  mock.commands = [];
  mock.failRestart = false;
  mock.noUserManager = false;
  mock.failBootstrap = false;
});

async function fixture() {
  mock.home = await mkdtemp(join(tmpdir(), "relay-service-install-"));
  Object.defineProperty(process, "platform", { value: "linux" });
  return {
    node: process.execPath,
    script: "/opt/relay/lib/relay.cjs",
    home: join(mock.home, "new-home"),
    path: "/usr/bin",
  };
}

it("restarts the loaded unit when replacing a service that used another home", async () => {
  const spec = await fixture();
  const file = serviceFile("systemd");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    systemdService({ ...spec, home: join(mock.home, "old-home") }),
  );
  await installService(spec);
  expect(await readFile(file, "utf8")).toBe(systemdService(spec));
  expect(mock.commands.filter(([command]) => command === "systemctl")).toEqual([
    ["systemctl", "--user", "daemon-reload"],
    ["systemctl", "--user", "enable", "relay.service"],
    ["systemctl", "--user", "restart", "relay.service"],
  ]);
});

it("does not report a successful installation when the replacement fails to start", async () => {
  const spec = await fixture();
  mock.failRestart = true;
  await expect(installService(spec)).rejects.toThrow("restart failed");
});

it("leaves no unit behind where this user has no systemd to load it", async () => {
  // A container, WSL without systemd, or `sudo -u` into an account with no session.
  const spec = await fixture();
  mock.noUserManager = true;
  await expect(installService(spec)).rejects.toThrow(
    "Failed to connect to bus",
  );
  // Else every `relay start` after goes to systemctl too, and fails the same way.
  expect(installedService()).toBeNull();
});

it("keeps the unit set up before when this session can't reach systemd", async () => {
  const spec = await fixture();
  const file = serviceFile("systemd");
  const working = systemdService({
    ...spec,
    home: join(mock.home, "old-home"),
  });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, working);
  mock.noUserManager = true;
  await expect(installService(spec)).rejects.toThrow(
    "Failed to connect to bus",
  );
  // It still starts Relay at boot, where systemd runs for this user.
  expect(await readFile(file, "utf8")).toBe(working);
});

it("leaves no launch agent behind when launchd won't load it", async () => {
  const spec = await fixture();
  Object.defineProperty(process, "platform", { value: "darwin" });
  mock.failBootstrap = true;
  await expect(installService(spec)).rejects.toThrow(
    "launchd wouldn't load Relay",
  );
  // Else every `relay start` after goes to launchd too, and fails the same way.
  expect(installedService()).toBeNull();
});
