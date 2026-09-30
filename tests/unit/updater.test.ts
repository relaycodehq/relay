import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.1.0", on: vi.fn() },
  net: { fetch: vi.fn() },
}));
import { app, net } from "electron";
import { Updater } from "../../electron/updater";
import type { UpdateFile, UpdateState } from "../../shared/updates";

const bytes = Buffer.from("relay update payload ".repeat(4096));
const release = (data = bytes): UpdateFile => ({
  name: "Relay.zip",
  url: "https://example.test/Relay.zip",
  sha512: createHash("sha512").update(data).digest("base64"),
  size: data.length,
});
/** The download step on its own; which installs can download is platform-gated. */
const fetchFile = (
  file: UpdateFile,
  dir: string,
  progress: (fraction: number) => void = () => {},
): Promise<string> =>
  (new Updater(() => {}) as any).fetchFile(file, dir, progress);
const serve = (body: ReadableStream<Uint8Array> | Buffer) =>
  vi.mocked(net.fetch).mockResolvedValue(new Response(body as BodyInit));

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(net.fetch).mockReset();
});

/** An updater on a test feed, for a copy that can replace itself. */
function checker(emit: (state: UpdateState) => void = () => {}) {
  process.env.RELAY_UPDATE_FEED = "https://example.test/latest.json";
  const updater = new Updater(emit);
  delete process.env.RELAY_UPDATE_FEED;
  Object.assign(updater as any, { install: { target: "linux-x64-appimage" } });
  return updater;
}
const feed = (version: string) =>
  Response.json({ version, files: { "linux-x64-appimage": release() } });

it("offers a newer release, and notes the time when there's none", async () => {
  const updater = checker();
  vi.mocked(net.fetch).mockResolvedValueOnce(feed("0.2.0"));
  expect(await updater.check()).toMatchObject({
    status: "available",
    version: "0.2.0",
    install: "auto",
  });
  vi.mocked(net.fetch).mockResolvedValueOnce(feed("0.1.0"));
  expect(await updater.check()).toMatchObject({
    status: "idle",
    checkedAt: expect.any(Number),
  });
});

it("joins a check already under way", async () => {
  const updater = checker();
  vi.mocked(net.fetch).mockResolvedValueOnce(feed("0.1.0"));
  const [first, second] = await Promise.all([updater.check(), updater.check()]);
  expect(net.fetch).toHaveBeenCalledTimes(1);
  expect(second).toBe(first);
});

it("says why a check failed and goes back to idle", async () => {
  const seen: string[] = [];
  const updater = checker((s) => seen.push(s.status));
  vi.mocked(net.fetch).mockRejectedValueOnce(
    new Error("net::ERR_INTERNET_DISCONNECTED"),
  );
  await expect(updater.check()).rejects.toThrow("Couldn't reach example.test.");
  expect(updater.current).toEqual({ status: "idle", current: "0.1.0" });
  expect(seen).toEqual(["checking", "idle"]);
  vi.mocked(net.fetch).mockResolvedValueOnce(new Response("<!doctype html>"));
  await expect(updater.check()).rejects.toThrow("can't read");
});

it("keeps an offer in place while looking for a newer one", async () => {
  const seen: string[] = [];
  const updater = checker((s) => seen.push(s.status));
  vi.mocked(net.fetch).mockResolvedValueOnce(feed("0.2.0"));
  const offer = await updater.check();
  seen.length = 0;
  vi.mocked(net.fetch).mockRejectedValueOnce(new Error("offline"));
  await expect(updater.check()).rejects.toThrow();
  expect(updater.current).toEqual(offer);
  vi.mocked(net.fetch).mockResolvedValueOnce(feed("0.3.0"));
  expect(await updater.check()).toMatchObject({ version: "0.3.0" });
  expect(seen).not.toContain("checking");
});

it("checks again on coming back to Relay once the last check is old", async () => {
  vi.useFakeTimers();
  vi.mocked(app.on).mockClear();
  const updater = checker();
  vi.mocked(net.fetch).mockImplementation(async () => feed("0.1.0"));
  updater.start();
  const calls = vi.mocked(app.on).mock.calls as unknown as [
    string,
    () => void,
  ][];
  const focus = calls.find(([event]) => event === "browser-window-focus")![1];
  focus();
  expect(net.fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(net.fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(29 * 60_000);
  focus();
  expect(net.fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  focus();
  await vi.advanceTimersByTimeAsync(0);
  expect(net.fetch).toHaveBeenCalledTimes(2);
});

it("writes a verified download and reports progress", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-update-"));
  serve(bytes);
  const seen: number[] = [];
  const path = await fetchFile(release(), dir, (f) => seen.push(f));
  expect(await readFile(path)).toEqual(bytes);
  expect(seen[0]).toBe(0);
  expect(seen.at(-1)).toBe(1);
});

it("rejects a download that doesn't match the release", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-update-"));
  serve(Buffer.from("tampered"));
  await expect(fetchFile(release(), dir)).rejects.toThrow(
    "The download didn't match the release",
  );
});

it("reports a disk error instead of crashing on an unhandled stream error", async () => {
  serve(bytes);
  await expect(
    fetchFile(release(), join(tmpdir(), "relay-missing-dir", "nested")),
  ).rejects.toThrow(/ENOENT/);
});

it("gives up on a stalled connection", async () => {
  vi.useFakeTimers();
  const dir = await mkdtemp(join(tmpdir(), "relay-update-"));
  vi.mocked(net.fetch).mockImplementation(async (_url, init) => {
    let fail!: (reason: unknown) => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 100));
        fail = (reason) => controller.error(reason);
      },
    });
    init?.signal?.addEventListener("abort", () =>
      fail(new DOMException("aborted", "AbortError")),
    );
    return new Response(body);
  });
  const download = fetchFile(release(), dir);
  const settled = expect(download).rejects.toThrow("The download stalled");
  await vi.advanceTimersByTimeAsync(60_000);
  await settled;
});

/** An updater with a download staged, whose install fails harmlessly. */
function staged(
  runningTasks: () => number,
  emit: (state: UpdateState) => void = () => {},
) {
  process.env.APPIMAGE = join(tmpdir(), "relay-missing-dir", "Relay.AppImage");
  const updater = new Updater(emit, { runningTasks, beforeQuit() {} });
  Object.assign(updater as any, {
    state: { status: "ready", current: "0.1.0", version: "0.2.0" },
    staged: { version: "0.2.0", path: join(tmpdir(), "relay-missing-update") },
    install: { target: "linux-x64-appimage" },
  });
  return updater;
}

it("holds the restart until Claude's background work finishes", async () => {
  vi.useFakeTimers();
  let tasks = 2;
  // The failing install is real disk I/O and may settle within a timer tick,
  // so check the sequence of states rather than the state at one instant.
  const seen: string[] = [];
  const updater = staged(
    () => tasks,
    (s) => seen.push(s.status),
  );
  expect(await updater.installAndRestart()).toMatchObject({
    status: "waiting",
    tasks: 2,
  });
  tasks = 1;
  await vi.advanceTimersByTimeAsync(5000);
  expect(updater.current).toMatchObject({ status: "waiting", tasks: 1 });
  expect(seen).not.toContain("installing");
  tasks = 0;
  await vi.advanceTimersByTimeAsync(5000);
  expect(seen).toContain("installing");
  vi.useRealTimers();
  // The staged file is missing, so the install itself fails.
  await vi.waitFor(() => expect(updater.current.status).toBe("error"));
});

it("restarts right away when asked again while waiting", async () => {
  const updater = staged(() => 1);
  await updater.installAndRestart();
  expect((await updater.installAndRestart()).status).toBe("error");
});
