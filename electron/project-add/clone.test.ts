import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { cloneRepository, cloneProgress } from "./clone";

it("turns git's progress lines into one rising fraction", () => {
  const at = (line: string) => cloneProgress(line)?.progress ?? null;
  const steps = [
    "remote: Counting objects:  50% (5/10)",
    "Receiving objects:   0% (0/120)",
    "Receiving objects:  50% (60/120), 1.2 MiB | 2 MiB/s",
    "Resolving deltas: 100% (40/40), done.",
    "Updating files: 100% (300/300), done.",
  ].map(at);
  expect(steps.every((p) => p !== null)).toBe(true);
  expect([...steps].sort((a, b) => a! - b!)).toEqual(steps);
  expect(steps.at(-1)).toBe(1);
  expect(cloneProgress("Cloning into 'web'...")).toBeNull();
  expect(cloneProgress("remote: Enumerating objects: 5, done.")).toBeNull();
});

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../git/git", () => ({
  gitExecutable: async () => "git",
  gitEnv: () => ({}),
  redactCredentials: (text: string) => text,
}));
it("does not settle a cancelled clone until its process closes", async () => {
  const child = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
  });
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>,
  );
  const stop = new AbortController();
  let settled = false;
  const cloning = cloneRepository(
    "https://example.com/acme/web",
    "/sample/web",
    { extraArgs: [], onProgress: () => {}, signal: stop.signal },
  );
  const failed = expect(cloning).rejects.toThrow("Cancelled.");
  void cloning.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
  stop.abort();
  child.emit(
    "error",
    Object.assign(new Error("aborted"), { name: "AbortError" }),
  );
  // Drain the error's microtasks while close is still withheld.
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
  child.emit("close", null);
  await failed;
  expect(settled).toBe(true);
});
