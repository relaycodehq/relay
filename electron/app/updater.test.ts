import { afterEach, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.1.0", on: vi.fn() },
  net: { fetch: vi.fn() },
}));
import { app, net } from "electron";
import { Updater } from "./updater";
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

/** The test feed's signing key, which only a development build accepts. */
function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x!;
  return { privateKey, key: Buffer.from(x, "base64url").toString("base64") };
}
const testKey = keyPair();

/** An updater on a test feed, for a copy that can replace itself. */
function checker(emit: (state: UpdateState) => void = () => {}) {
  process.env.RELAY_UPDATE_FEED = "https://example.test/latest.json";
  process.env.RELAY_UPDATE_KEY = testKey.key;
  const updater = new Updater(emit);
  delete process.env.RELAY_UPDATE_FEED;
  delete process.env.RELAY_UPDATE_KEY;
  Object.assign(updater as any, { install: { target: "linux-x64-appimage" } });
  return updater;
}
const feedBytes = (version: string) =>
  Buffer.from(
    JSON.stringify(
      { version, files: { "linux-x64-appimage": release() } },
      null,
      2,
    ),
  );
const signed = (bytes: Buffer, by = testKey.privateKey) =>
  sign(null, bytes, by).toString("base64");
/**
 * Serves latest.json and latest.json.sig: `version`'s feed signed by the test
 * key unless `bytes` or `signature` (null: no .sig at all) say otherwise.
 */
function answer(
  version: string,
  {
    bytes = feedBytes(version),
    signature = signed(bytes),
    feed,
  }: {
    bytes?: Buffer;
    signature?: string | null;
    feed?: Promise<Response>;
  } = {},
) {
  vi.mocked(net.fetch).mockImplementation(async (url) =>
    String(url).endsWith(".sig")
      ? signature === null
        ? new Response("Not Found", { status: 404 })
        : new Response(signature)
      : (feed ?? new Response(new Uint8Array(bytes))),
  );
}
/** How many times the feed itself was fetched, leaving out its signature. */
const feedFetches = () =>
  vi
    .mocked(net.fetch)
    .mock.calls.filter(([url]) => !String(url).endsWith(".sig")).length;

it("offers a newer release, and notes the time when there's none", async () => {
  const updater = checker();
  answer("0.2.0");
  expect(await updater.check()).toMatchObject({
    status: "available",
    version: "0.2.0",
    install: "auto",
  });
  answer("0.1.0");
  expect(await updater.check()).toMatchObject({
    status: "idle",
    checkedAt: expect.any(Number),
  });
});

it("joins a check already under way", async () => {
  const updater = checker();
  answer("0.1.0");
  const [first, second] = await Promise.all([updater.check(), updater.check()]);
  expect(feedFetches()).toBe(1);
  expect(second).toBe(first);
});

it("says why a check failed and goes back to idle", async () => {
  const seen: string[] = [];
  const updater = checker((s) => seen.push(s.status));
  vi.mocked(net.fetch).mockRejectedValue(
    new Error("net::ERR_INTERNET_DISCONNECTED"),
  );
  await expect(updater.check()).rejects.toThrow("Couldn't reach example.test.");
  expect(updater.current).toEqual({ status: "idle", current: "0.1.0" });
  expect(seen).toEqual(["checking", "idle"]);
  answer("0.2.0", { bytes: Buffer.from("<!doctype html>") });
  await expect(updater.check()).rejects.toThrow("can't read");
});

it("refuses a feed that isn't signed by a trusted key", async () => {
  const updater = checker();
  answer("0.2.0", { signature: null });
  await expect(updater.check()).rejects.toThrow("isn't signed");
  const bytes = feedBytes("0.2.0");
  answer("0.2.0", { signature: signed(bytes, keyPair().privateKey) });
  await expect(updater.check()).rejects.toThrow("signature doesn't check out");
  // Signed, then changed on the way.
  const tampered = Buffer.from(bytes);
  tampered[tampered.indexOf("0.2.0") + 2] = "9".charCodeAt(0);
  answer("0.2.0", { bytes: tampered, signature: signed(bytes) });
  await expect(updater.check()).rejects.toThrow("signature doesn't check out");
  expect(updater.current).toEqual({ status: "idle", current: "0.1.0" });
  expect((updater as any).manifest).toBeUndefined();
});

it("trusts a test key only in a development build", async () => {
  Object.assign(app, { isPackaged: true });
  try {
    const updater = checker();
    answer("0.2.0");
    await expect(updater.check()).rejects.toThrow(
      "signature doesn't check out",
    );
  } finally {
    Object.assign(app, { isPackaged: false });
  }
});

it("keeps an offer in place while looking for a newer one", async () => {
  const seen: string[] = [];
  const updater = checker((s) => seen.push(s.status));
  answer("0.2.0");
  const offer = await updater.check();
  seen.length = 0;
  vi.mocked(net.fetch).mockRejectedValue(new Error("offline"));
  await expect(updater.check()).rejects.toThrow();
  expect(updater.current).toEqual(offer);
  answer("0.3.0");
  expect(await updater.check()).toMatchObject({ version: "0.3.0" });
  expect(seen).not.toContain("checking");
});

it("skips a downloaded release once a newer one is out", async () => {
  const updater = checker();
  const dir = await mkdtemp(join(tmpdir(), "relay-update-"));
  Object.assign(updater as any, {
    state: { status: "ready", current: "0.1.0", version: "0.2.0" },
    staged: { version: "0.2.0", path: join(dir, "Relay.AppImage"), dir },
  });
  answer("0.2.0");
  expect(await updater.check()).toMatchObject({
    status: "ready",
    version: "0.2.0",
  });
  answer("0.3.0");
  expect(await updater.check()).toMatchObject({
    status: "available",
    version: "0.3.0",
  });
  expect((updater as any).staged).toBeUndefined();
  await vi.waitFor(() => expect(stat(dir)).rejects.toThrow(/ENOENT/));
});

it("leaves the state to a restart pressed while a check is out", async () => {
  const updater = checker();
  const dir = join(tmpdir(), "relay-update-restart");
  await mkdir(dir, { recursive: true });
  const ready = { status: "ready", current: "0.1.0", version: "0.2.0" };
  Object.assign(updater as any, {
    state: ready,
    staged: { version: "0.2.0", path: join(dir, "Relay.AppImage"), dir },
  });
  let respond!: (response: Response) => void;
  answer("0.3.0", { feed: new Promise((resolve) => (respond = resolve)) });
  const check = updater.check();
  (updater as any).set({ ...ready, status: "waiting", tasks: 1 });
  respond(new Response(new Uint8Array(feedBytes("0.3.0"))));
  expect(await check).toMatchObject({ status: "waiting", version: "0.2.0" });
  expect((updater as any).staged).toMatchObject({ version: "0.2.0" });
});

it("checks again on coming back to Relay once the last check is old", async () => {
  vi.useFakeTimers();
  vi.mocked(app.on).mockClear();
  const updater = checker();
  answer("0.1.0");
  updater.start();
  const calls = vi.mocked(app.on).mock.calls as unknown as [
    string,
    () => void,
  ][];
  const focus = calls.find(([event]) => event === "browser-window-focus")![1];
  focus();
  expect(feedFetches()).toBe(0);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(feedFetches()).toBe(1);
  await vi.advanceTimersByTimeAsync(29 * 60_000);
  focus();
  expect(feedFetches()).toBe(1);
  await vi.advanceTimersByTimeAsync(60_000);
  focus();
  await vi.advanceTimersByTimeAsync(0);
  expect(feedFetches()).toBe(2);
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
