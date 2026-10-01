import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { terminate } from "../../electron/terminate";
import { withTimeout } from "../../electron/timeout";

const exited = (child: ReturnType<typeof spawn>) =>
  new Promise<string | null>((resolve) =>
    child.once("exit", (_code, signal) => resolve(signal)),
  );

describe("terminate", () => {
  it("stops a child that exits on SIGTERM", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    const done = exited(child);
    terminate(child);
    expect(await done).toBe("SIGTERM");
  });

  it("kills a child that ignores SIGTERM once the grace period passes", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
    ]);
    await new Promise((resolve) => child.stdout.once("data", resolve));
    const done = exited(child);
    terminate(child, { graceMs: 200 });
    expect(await done).toBe("SIGKILL");
  });

  it("lets a child asked by its input wind down, and kills one that doesn't stop", async () => {
    const tidy = spawn(process.execPath, [
      "-e",
      "process.stdin.resume(); process.stdin.on('end', () => setTimeout(() => process.exit(0), 100))",
    ]);
    const tidied = exited(tidy);
    terminate(tidy, { byInput: true, graceMs: 5000 });
    expect(await tidied).toBeNull();

    const stuck = spawn(process.execPath, [
      "-e",
      "console.log('ready'); setInterval(() => {}, 1000)",
    ]);
    await new Promise((resolve) => stuck.stdout.once("data", resolve));
    const killed = exited(stuck);
    terminate(stuck, { byInput: true, graceMs: 200 });
    expect(await killed).toBe("SIGKILL");
  });
});

describe("withTimeout", () => {
  it("passes the result through", async () => {
    await expect(withTimeout(Promise.resolve(4), 50, "late")).resolves.toBe(4);
  });

  it("rejects with the message when the work is too slow", async () => {
    await expect(
      withTimeout(new Promise(() => {}), 20, "took too long"),
    ).rejects.toThrow("took too long");
  });
});
