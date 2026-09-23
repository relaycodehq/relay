import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.1.0" },
  net: { fetch: vi.fn() },
}));
import { net } from "electron";
import { Updater } from "../../electron/updater";
import type { UpdateFile } from "../../shared/updates";

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
function staged(runningTasks: () => number) {
  process.env.APPIMAGE = join(tmpdir(), "relay-missing-dir", "Relay.AppImage");
  const updater = new Updater(() => {}, { runningTasks, beforeQuit() {} });
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
  const updater = staged(() => tasks);
  expect(await updater.installAndRestart()).toMatchObject({
    status: "waiting",
    tasks: 2,
  });
  tasks = 1;
  await vi.advanceTimersByTimeAsync(5000);
  expect(updater.current).toMatchObject({ status: "waiting", tasks: 1 });
  tasks = 0;
  await vi.advanceTimersByTimeAsync(5000);
  expect(updater.current.status).toBe("installing");
  vi.useRealTimers();
  // The staged file is missing, so the install itself fails.
  await vi.waitFor(() => expect(updater.current.status).toBe("error"));
});

it("restarts right away when asked again while waiting", async () => {
  const updater = staged(() => 1);
  await updater.installAndRestart();
  expect((await updater.installAndRestart()).status).toBe("error");
});
