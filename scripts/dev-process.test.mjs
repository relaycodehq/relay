import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { stopDevServer } from "./dev-process.mjs";

vi.mock("node:child_process", async (original) => ({
  ...(await original()),
  execFile: vi.fn((_file, _args, _options, done) => done(null)),
}));
import { execFile } from "node:child_process";

afterEach(() => vi.restoreAllMocks());

it("uses taskkill only on the dev server's tree on Windows", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null,
    signalCode: null,
  });
  await stopDevServer(child);
  expect(execFile).toHaveBeenCalledWith(
    "taskkill",
    ["/PID", "123", "/T", "/F"],
    { windowsHide: true },
    expect.any(Function),
  );
});

it.skipIf(process.platform === "win32")(
  "stops a server process group on macOS/Linux",
  async () => {
    const child = spawn(
      process.execPath,
      ["-e", "console.log('ready'); setInterval(() => {}, 1000)"],
      { detached: true },
    );
    await new Promise((resolve) => child.stdout.once("data", resolve));
    try {
      await stopDevServer(child);
      expect(child.signalCode).toBe("SIGTERM");
    } finally {
      if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
    }
  },
);
