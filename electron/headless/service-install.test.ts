import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  home: "",
  commands: [] as string[][],
  failRestart: false,
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
    callback(
      mock.failRestart && args.includes("restart")
        ? new Error("restart failed")
        : null,
      "",
      "",
    );
  },
}));
import { installService, serviceFile, systemdService } from "./service";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(async () => {
  Object.defineProperty(process, "platform", platform);
  if (mock.home) await rm(mock.home, { recursive: true, force: true });
  mock.home = "";
  mock.commands = [];
  mock.failRestart = false;
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
