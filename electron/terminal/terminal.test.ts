import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { findExecutable } from "../platform/executables";
import { openLinuxTerminal, openWindowsTerminal } from "./terminal";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../platform/executables");

beforeEach(() => vi.resetAllMocks());

function spawned(error?: Error) {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  queueMicrotask(() => child.emit(error ? "error" : "spawn", error));
  return child as unknown as ReturnType<typeof spawn>;
}

it("uses the desktop's configured terminal with literal paths and repository cwd", async () => {
  vi.mocked(findExecutable).mockImplementation(
    async (name) => `/usr/bin/${name}`,
  );
  vi.mocked(spawn).mockImplementation(() => spawned());
  const root = "/home/friend/project with 'quotes' $(nope)";
  const script = "/home/friend/Relay/handoffs/test.command";
  await openLinuxTerminal(root, script);
  expect(findExecutable).toHaveBeenCalledTimes(1);
  expect(spawn).toHaveBeenCalledWith(
    "/usr/bin/xdg-terminal-exec",
    [`--dir=${root}`, "--", script],
    { cwd: root, detached: true, stdio: "ignore" },
  );
});

it("retains other Linux desktop terminals when XDG launch is unavailable", async () => {
  vi.mocked(findExecutable).mockImplementation(async (name) => {
    if (name === "x-terminal-emulator") throw new Error("missing");
    return `/usr/bin/${name}`;
  });
  vi.mocked(spawn)
    .mockImplementationOnce(() => spawned(new Error("ENOENT")))
    .mockImplementationOnce(() => spawned());
  await openLinuxTerminal("/repo", "/private/task.command");
  expect(spawn).toHaveBeenLastCalledWith(
    "/usr/bin/gnome-terminal",
    ["--", "/private/task.command"],
    { cwd: "/repo", detached: true, stdio: "ignore" },
  );
});

it("reports a missing terminal instead of claiming a handoff succeeded", async () => {
  vi.mocked(findExecutable).mockRejectedValue(new Error("missing"));
  await expect(openLinuxTerminal("/repo", "/task.command")).rejects.toThrow(
    "xdg-terminal-exec",
  );
  expect(spawn).not.toHaveBeenCalled();
});

it("escapes semicolons Windows Terminal would read as another tab", async () => {
  vi.mocked(findExecutable).mockResolvedValue("C:\\WindowsApps\\wt.exe");
  vi.mocked(spawn).mockImplementation(() => spawned());
  const root = "C:\\Users\\bob\\a;b";
  const script = "C:\\Users\\bob\\Relay;data\\handoffs\\task.ps1";
  await openWindowsTerminal(root, script);
  expect(spawn).toHaveBeenCalledWith(
    "C:\\WindowsApps\\wt.exe",
    [
      "-d",
      "C:\\Users\\bob\\a\\;b",
      "powershell.exe",
      "-NoExit",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\Users\\bob\\Relay\\;data\\handoffs\\task.ps1",
    ],
    { cwd: root, detached: true, stdio: "ignore" },
  );
});
