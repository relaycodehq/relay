import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return { app: new EventEmitter() };
});

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(() => Object.assign(new EventEmitter(), { unref() {} })),
}));

import { app } from "electron";
import { spawn } from "node:child_process";
import { apply } from "./install-update";

const quitting = () => (app as unknown as EventEmitter).emit("will-quit");

it("starts the Windows installer only once the quit can't be cancelled", async () => {
  await apply("win-x64", "C:\\Temp\\relay-update\\Relay-0.2.0-win-x64.exe");
  // The quit may still stop at the unsaved-edits prompt or a failed save.
  expect(spawn).not.toHaveBeenCalled();

  quitting();
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(vi.mocked(spawn).mock.calls[0][1]).toEqual([
    "--updated",
    "/S",
    "--force-run",
  ]);
});

it("lets Relay quit when the installer is gone", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await apply("win-x64", "C:\\Temp\\relay-update\\missing.exe");
  quitting();
  const installer = vi.mocked(spawn).mock.results.at(-1)!.value as ChildProcess;
  expect(() =>
    installer.emit("error", new Error("spawn missing.exe ENOENT")),
  ).not.toThrow();
});
