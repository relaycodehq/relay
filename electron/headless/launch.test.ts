import { afterEach, expect, it, vi } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callControl, NotRunning } from "./control";
import {
  AlreadyRunning,
  autoUpdateEnabled,
  claimHome,
  readConfig,
  saveConfig,
  stopForService,
} from "./launch";

vi.mock("./control", async (importOriginal) => {
  const original = await importOriginal<typeof import("./control")>();
  return { ...original, callControl: vi.fn() };
});
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
  vi.resetAllMocks();
});
async function home() {
  const dir = await mkdtemp(join(tmpdir(), "relay-home-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

it("allows only one concurrent claimant even with an empty or stale PID file", async () => {
  for (const content of ["", "2147483647\n"]) {
    const dir = await home(),
      pid = join(dir, "relay.pid");
    await writeFile(pid, content);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => claimHome(pid)),
    );
    const acquired = results.filter((result) => result.status === "fulfilled");
    expect(acquired).toHaveLength(1);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason).toBeInstanceOf(AlreadyRunning);
    const winner = acquired[0]!;
    if (winner.status === "fulfilled") cleanup.push(winner.value);
    expect((await readFile(pid, "utf8")).trim()).toBe(String(process.pid));
  }
});

it("secures an existing home before claiming it", async () => {
  const dir = await home();
  await chmod(dir, 0o777);
  const release = await claimHome(join(dir, "relay.pid"));
  cleanup.push(release);
  if (process.platform !== "win32")
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
});

it("detaches and awaits the old daemon before service installation", async () => {
  const dir = await home();
  const call = vi.mocked(callControl);
  call.mockResolvedValueOnce({ pid: process.pid } as never);
  call.mockResolvedValueOnce(undefined as never);
  call.mockRejectedValueOnce(new NotRunning());
  await stopForService(dir);
  expect(call.mock.calls.map(([, method]) => method)).toEqual([
    "status",
    "stop",
    "status",
  ]);
  expect(call.mock.calls[1]).toEqual([
    join(dir, "relay.sock"),
    "stop",
    { detach: true },
  ]);
});

it("does not replace malformed configuration with defaults", async () => {
  const dir = await home();
  const path = join(dir, "headless.json");
  expect(await readConfig(dir)).toEqual({});
  await writeFile(path, '{"autoUpdate":');
  await expect(readConfig(dir)).rejects.toThrow("isn't valid");
  await expect(saveConfig(dir, { autoUpdate: true })).rejects.toThrow(
    "isn't valid",
  );
  expect(await readFile(path, "utf8")).toBe('{"autoUpdate":');
  await rm(path);
  await mkdir(path);
  await expect(readConfig(dir)).rejects.toMatchObject({ code: "EISDIR" });
});

it("keeps automatic updates disabled when live config is invalid or unreadable", async () => {
  const dir = await home();
  const path = join(dir, "headless.json");
  expect(await autoUpdateEnabled(dir)).toBe(true);
  await saveConfig(dir, { autoUpdate: false });
  expect(await autoUpdateEnabled(dir)).toBe(false);
  await writeFile(path, "malformed");
  expect(await autoUpdateEnabled(dir)).toBe(false);
  await rm(path);
  await mkdir(path);
  expect(await autoUpdateEnabled(dir)).toBe(false);
});
