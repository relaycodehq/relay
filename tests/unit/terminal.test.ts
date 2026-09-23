import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { findExecutable } from "../../electron/executables";
import { openLinuxTerminal } from "../../electron/terminal";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../../electron/executables", async (actual) => ({
  ...(await actual<typeof import("../../electron/executables")>()),
  findExecutable: vi.fn(),
}));
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
  const script = "/home/friend/Review Relay/handoffs/test.command";
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
