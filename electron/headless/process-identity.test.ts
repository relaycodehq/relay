import { afterEach, expect, it, vi } from "vitest";
import { recordedAlive, recordProcess } from "./process-identity";

/** Windows' answers by pid, as PowerShell prints them; a pid missing here is gone. */
const windows = vi.hoisted(() => ({
  created: undefined as Map<number, string> | undefined,
  asked: [] as number[],
  /** PowerShell times out instead of answering. */
  stuck: false,
}));

vi.mock("node:child_process", async (original) => {
  const real = await original<typeof import("node:child_process")>();
  return {
    ...real,
    execFileSync: ((file: string, args: string[], options: object) => {
      if (!windows.created) return real.execFileSync(file, args, options);
      const pid = Number(/ProcessId=(\d+)/.exec(args.join(" "))?.[1]);
      windows.asked.push(pid);
      if (windows.stuck)
        throw Object.assign(new Error("spawnSync powershell.exe ETIMEDOUT"), {
          status: null,
        });
      return `${windows.created.get(pid) ?? ""}\r\n`;
    }) as typeof real.execFileSync,
  };
});

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  windows.created = undefined;
  windows.asked = [];
  windows.stuck = false;
});

const alive = (pid: number) => pid === process.pid;

it("takes a recorded pid only for the process that wrote it", () => {
  expect(recordedAlive(recordProcess(), alive)).toBe(true);
  // The same number, now some other process: after WSL restarts a distribution, say.
  expect(recordedAlive(`${process.pid} 1`, alive)).toBe(false);
  expect(recordedAlive("999999 1", alive)).toBe(false);
  // Written before starts were recorded: the pid alone decides.
  expect(recordedAlive(`${process.pid}\n`, alive)).toBe(true);
  expect(recordedAlive("", alive)).toBe(false);
});

it.runIf(process.platform === "darwin")(
  "records when a process started on macOS too, so a pid reused after a restart doesn't count",
  () => {
    const [pid, start] = recordProcess().split(" ");
    expect(Number(pid)).toBe(process.pid);
    expect(start).toBeTruthy();
    // The same pid, written by a Relay before the computer restarted.
    expect(recordedAlive(`${process.pid} Mon-Jan-1-00:00:00-2024`, alive)).toBe(
      false,
    );
  },
);

it("tells a pid Windows gave another process after signing out from Relay's own", () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  windows.created = new Map([[process.pid, "134383540023455520"]]);
  const record = recordProcess();
  expect(record).toBe(`${process.pid} 134383540023455520`);
  expect(recordedAlive(record, alive)).toBe(true);
  // Signing out killed Relay without cleanup; its pid now names something else.
  windows.created.set(process.pid, "134383611112222330");
  expect(recordedAlive(record, alive)).toBe(false);
  // Gone between the two questions.
  windows.created.delete(process.pid);
  expect(recordedAlive(record, alive)).toBe(false);
});

it("asks Windows when a process started only while its pid is alive", () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  windows.created = new Map();
  expect(recordedAlive("4242 134383540023455520", () => false)).toBe(false);
  expect(windows.asked).toEqual([]);
});

it("keeps a live pid its owner's when Windows doesn't say when it started", () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  windows.created = new Map([[process.pid, "134383540023455520"]]);
  const record = recordProcess();
  windows.stuck = true;
  expect(recordedAlive(record, alive)).toBe(true);
  // Recorded while stuck: the pid alone decides later.
  expect(recordProcess()).toBe(`${process.pid}`);
});
