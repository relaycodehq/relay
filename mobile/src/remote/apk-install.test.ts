import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: {
    checksums: true as boolean | undefined,
    download: vi.fn(),
    install: vi.fn(),
    canInstall: vi.fn(),
    allowInstalls: vi.fn(),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  appListeners: [] as ((state: string) => void)[],
  openURL: vi.fn(),
  present: true,
  pending: "0.9.1",
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => mocks.present ? mocks.native : null }));
vi.mock("./self-update", () => ({ pendingVersion: () => mocks.pending }));
vi.mock("react", () => ({
  useSyncExternalStore: (_: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-native", () => ({
  Linking: { openURL: mocks.openURL },
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      mocks.appListeners.push(listener);
      return {
        remove: () => {
          mocks.appListeners = mocks.appListeners.filter((l) => l !== listener);
        },
      };
    },
  },
}));

const desktop = { version: "0.10.0", url: "https://example.test/desktop.apk" };
const feed = {
  ...desktop,
  url: "https://example.test/feed.apk",
  sha512: "checksum",
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.native.checksums = true;
  mocks.present = true;
  mocks.pending = "0.9.1";
  mocks.native.download.mockResolvedValue("/cache/Relay.apk");
  mocks.native.install.mockResolvedValue("cancelled");
  mocks.native.canInstall.mockReturnValue(false);
  mocks.appListeners = [];
});

it("opens one permission screen and leaves one listener for simultaneous taps", async () => {
  const { installApk } = await import("./apk-install");
  await Promise.all([installApk(feed), installApk(feed)]);
  expect(mocks.native.download).toHaveBeenCalledTimes(1);
  expect(mocks.native.allowInstalls).toHaveBeenCalledTimes(1);
  expect(mocks.appListeners).toHaveLength(1);
  await installApk(feed);
  expect(mocks.native.download).toHaveBeenCalledTimes(2);
  expect(mocks.appListeners).toHaveLength(1);
  mocks.native.canInstall.mockReturnValue(true);
  mocks.appListeners[0]("active");
  await vi.waitFor(() => expect(mocks.native.install).toHaveBeenCalledTimes(1));
  expect(mocks.appListeners).toHaveLength(0);
});

it("checks the feed's checksum after joining a desktop download of the same version", async () => {
  const { installApk, prefetchApk } = await import("./apk-install");
  let finish!: (path: string) => void;
  mocks.native.download.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  mocks.native.canInstall.mockReturnValue(true);
  prefetchApk(desktop);
  await vi.waitFor(() =>
    expect(mocks.native.download).toHaveBeenCalledTimes(1),
  );
  const requested = installApk(feed);
  finish("/cache/Relay.apk");
  await requested;
  expect(mocks.native.download.mock.calls).toEqual([
    [desktop.url, desktop.version, ""],
    [feed.url, feed.version, feed.sha512],
  ]);
  expect(mocks.native.install).toHaveBeenCalledTimes(1);
});

it("waits for an older prefetch instead of swallowing a newer update tap", async () => {
  const { installApk, prefetchApk } = await import("./apk-install");
  let finish!: (path: string) => void;
  mocks.native.download.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  mocks.native.canInstall.mockReturnValue(true);
  prefetchApk(desktop);
  await vi.waitFor(() =>
    expect(mocks.native.download).toHaveBeenCalledTimes(1),
  );
  const newer = { ...feed, version: "0.11.0" };
  const requested = installApk(newer);
  finish("/cache/Relay.apk");
  await requested;
  expect(mocks.native.download).toHaveBeenLastCalledWith(
    newer.url,
    newer.version,
    newer.sha512,
  );
  expect(mocks.native.install).toHaveBeenCalledTimes(1);
});

it("uses the old two-argument native download when checksum support is missing", async () => {
  const { installApk, onMeteredNetwork } = await import("./apk-install");
  mocks.native.checksums = undefined;
  await installApk(feed);
  expect(mocks.native.download).toHaveBeenCalledWith(feed.url, feed.version);
  expect(onMeteredNetwork()).toBeUndefined();
});

it("recovers after a native listener throws synchronously", async () => {
  const { installApk, useApkInstall } = await import("./apk-install");
  mocks.native.addListener.mockImplementationOnce(() => {
    throw new Error("native failed");
  });
  await installApk(feed);
  expect(useApkInstall()).toMatchObject({
    kind: "failed",
    message: "native failed",
  });
  await installApk(feed);
  expect(mocks.native.download).toHaveBeenCalledTimes(1);
});

it("uses the browser in Expo Go and handles an unavailable browser", async () => {
  mocks.present = false;
  const { installApk, useApkInstall } = await import("./apk-install");
  mocks.openURL.mockRejectedValueOnce(new Error("no browser"));
  await installApk(feed);
  expect(mocks.openURL).toHaveBeenCalledWith(feed.url);
  expect(useApkInstall()).toMatchObject({ kind: "failed", message: "no browser" });
  expect(mocks.native.download).not.toHaveBeenCalled();
  mocks.openURL.mockResolvedValueOnce(undefined);
  await installApk(feed);
  expect(useApkInstall()).toEqual({ kind: "idle" });
});

it("uses the browser for a development build even when its native installer exists", async () => {
  const { installApk, useApkInstall } = await import("./apk-install");
  mocks.openURL.mockRejectedValueOnce(new Error("no browser"));
  await installApk(feed, { browser: true });
  expect(mocks.openURL).toHaveBeenCalledWith(feed.url);
  expect(useApkInstall()).toMatchObject({ kind: "failed", message: "no browser" });
  expect(mocks.native.download).not.toHaveBeenCalled();
});

it("refuses an APK when newer desktop code arrived during its download", async () => {
  const { installApk, useApkInstall } = await import("./apk-install");
  mocks.native.download.mockImplementationOnce(async () => {
    mocks.pending = "0.11.0";
    return "/cache/Relay.apk";
  });
  await installApk(feed);
  expect(useApkInstall()).toMatchObject({ kind: "failed", message: expect.stringContaining("older code") });
  expect(mocks.native.install).not.toHaveBeenCalled();
  expect(mocks.native.allowInstalls).not.toHaveBeenCalled();
});

it("rechecks staged code after returning from the install-permission screen", async () => {
  const { installApk, useApkInstall } = await import("./apk-install");
  await installApk(feed);
  mocks.pending = "0.11.0";
  mocks.native.canInstall.mockReturnValue(true);
  mocks.appListeners[0]("active");
  expect(useApkInstall()).toMatchObject({ kind: "failed", message: expect.stringContaining("older code") });
  expect(mocks.native.install).not.toHaveBeenCalled();
});

it("notices an already granted install permission even without an AppState event", async () => {
  const { installApk } = await import("./apk-install");
  await installApk(feed);
  mocks.native.canInstall.mockReturnValue(true);
  await installApk(feed);
  expect(mocks.native.install).toHaveBeenCalledTimes(1);
  expect(mocks.appListeners).toHaveLength(0);
});

it("checks a newly available checksum when retrying the same version's permission flow", async () => {
  const { installApk } = await import("./apk-install");
  await installApk(desktop);
  await installApk(feed);
  expect(mocks.native.download).toHaveBeenLastCalledWith(feed.url, feed.version, feed.sha512);
  expect(mocks.native.download).toHaveBeenCalledTimes(2);
  expect(mocks.appListeners).toHaveLength(1);
});
