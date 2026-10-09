import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saved: null as string | null,
  fetch: vi.fn(),
  save: vi.fn(),
  prefetch: vi.fn(),
  metered: vi.fn(),
  pending: "0.9.1",
  environment: "standalone",
}));
vi.mock("react", () => ({
  useEffect: vi.fn(),
  useSyncExternalStore: (_: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { addEventListener: vi.fn() },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => mocks.saved,
    setItem: async (_: string, value: string) => {
      mocks.save(value);
      mocks.saved = value;
    },
  },
}));
vi.mock("expo-constants", () => ({
  default: {
    get executionEnvironment() {
      return mocks.environment;
    },
    expoConfig: { version: "0.9.1", extra: { relayRuntime: "runtime" } },
  },
  ExecutionEnvironment: { StoreClient: "storeClient" },
}));
vi.mock("../../../shared/phone-release", async (original) => ({
  ...(await original<typeof import("../../../shared/phone-release")>()),
  fetchNewestApp: mocks.fetch,
}));
vi.mock("./apk-install", () => ({
  prefetchApk: mocks.prefetch,
  onMeteredNetwork: mocks.metered,
}));
vi.mock("./self-update", () => ({
  runningVersion: "0.9.1",
  pendingVersion: () => mocks.pending,
}));

const newest = {
  release: "0.10.2",
  version: "0.10.0",
  url: "https://example.test/Relay.apk",
  sha512: "A".repeat(86) + "==",
};
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("__DEV__", false);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
  mocks.saved = null;
  mocks.pending = "0.9.1";
  mocks.environment = "standalone";
  mocks.metered.mockReturnValue(false);
  mocks.fetch.mockResolvedValue(newest);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the six-hour successful check throttle across restarts", async () => {
  const first = await import("./latest-app");
  await first.checkLatestApp();
  vi.resetModules();
  const restarted = await import("./latest-app");
  await restarted.checkLatestApp();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 6 * 60 * 60_000);
  await restarted.checkLatestApp();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("keeps failed-check throttling across restarts and retries after ten minutes", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("offline"));
  const first = await import("./latest-app");
  await first.checkLatestApp();
  vi.resetModules();
  const restarted = await import("./latest-app");
  await restarted.checkLatestApp();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 10 * 60_000);
  await restarted.checkLatestApp();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("retries a forced failure after ten minutes even following a recent success", async () => {
  const { checkLatestApp } = await import("./latest-app");
  await checkLatestApp();
  mocks.fetch.mockRejectedValueOnce(new Error("offline"));
  await checkLatestApp(true);
  vi.setSystemTime(Date.now() + 10 * 60_000);
  await checkLatestApp();
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
});

it("retains the newer known app when a correctly signed older feed is replayed", async () => {
  const { checkLatestApp, useLatestApp } = await import("./latest-app");
  await checkLatestApp();
  mocks.fetch.mockResolvedValueOnce({
    ...newest,
    release: "0.9.1",
    version: "0.9.1",
  });
  await checkLatestApp(true);
  expect(useLatestApp()).toMatchObject({
    newest,
    error: expect.stringContaining("older release"),
  });
});

it("doesn't offer an APK that would discard newer staged desktop code", async () => {
  const { checkLatestApp, latestOffer, useLatestApp } =
    await import("./latest-app");
  mocks.pending = "0.11.0";
  await checkLatestApp();
  expect(latestOffer(useLatestApp())).toBeUndefined();
  expect(mocks.prefetch).not.toHaveBeenCalled();
});

it("retains a newer known APK when a later feed names an older app", async () => {
  const { checkLatestApp, useLatestApp } = await import("./latest-app");
  await checkLatestApp();
  mocks.fetch.mockResolvedValueOnce({ ...newest, release: "0.11.0", version: "0.9.1" });
  await checkLatestApp(true);
  expect(useLatestApp()).toMatchObject({ newest, error: expect.stringContaining("older release or app") });
});

it("replaces a legacy feed's guessed APK version with a newer feed's exact Android entry", async () => {
  const { checkLatestApp, useLatestApp } = await import("./latest-app");
  mocks.fetch.mockResolvedValueOnce({ ...newest, version: "0.10.2", sha512: undefined });
  await checkLatestApp();
  const exact = { ...newest, release: "0.10.3" };
  mocks.fetch.mockResolvedValueOnce(exact);
  await checkLatestApp(true);
  expect(useLatestApp()).toMatchObject({ newest: exact, checking: false });
  expect(useLatestApp().error).toBeUndefined();
});

it.each([
  [true, "standalone", false],
  [false, "storeClient", false],
  [false, "standalone", true],
])(
  "gates prefetch for dev=%s, environment=%s, metered=%s",
  async (dev, environment, metered) => {
    vi.stubGlobal("__DEV__", dev);
    mocks.environment = environment;
    mocks.metered.mockReturnValue(metered);
    const { checkLatestApp } = await import("./latest-app");
    await checkLatestApp();
    expect(mocks.prefetch).not.toHaveBeenCalled();
  },
);

it("prefetches a cached offer after returning on an unmetered network", async () => {
  mocks.saved = JSON.stringify({ newest, checkedAt: Date.now() });
  const { checkLatestApp } = await import("./latest-app");
  await checkLatestApp();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.prefetch).toHaveBeenCalledWith(newest);
});

it("ignores a damaged cache instead of letting it break foreground checks", async () => {
  mocks.saved = JSON.stringify({
    newest: { version: 42 },
    checkedAt: Date.now(),
  });
  const { checkLatestApp, useLatestApp } = await import("./latest-app");
  await checkLatestApp();
  expect(useLatestApp()).toMatchObject({ newest, checking: false });
});

it("handles storage failure without reporting a verified feed as a network error", async () => {
  mocks.save.mockImplementationOnce(() => {
    throw new Error("storage full");
  });
  const { checkLatestApp, useLatestApp } = await import("./latest-app");
  await checkLatestApp();
  expect(useLatestApp()).toMatchObject({ newest, checking: false });
  expect(useLatestApp().error).toBeUndefined();
});
