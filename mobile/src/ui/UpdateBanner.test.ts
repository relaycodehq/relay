import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { UpdateBanner } from "./UpdateBanner";

const mocks = vi.hoisted(() => ({
  update: { kind: "ready", version: "0.10.0" } as { kind: string; version: string; url?: string },
  offer: { version: "0.10.0", url: "https://example.test/Relay.apk", sha512: "checksum" } as
    { version: string; url: string; sha512: string } | undefined,
  install: vi.fn(),
  restart: vi.fn(),
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable", Text: "Text", StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("../remote/apk-install", () => ({ installApk: mocks.install, useApkInstall: () => ({ kind: "idle" }) }));
vi.mock("../remote/latest-app", () => ({ releaseBuild: true, useLatestApp: () => ({}), latestOffer: () => mocks.offer }));
vi.mock("../remote/self-update", () => ({ useSelfUpdate: () => mocks.update, restartIntoUpdate: mocks.restart }));
vi.mock("../remote/RemoteProvider", () => ({ useRemote: () => ({ name: "Older Relay" }) }));
vi.mock("./theme", () => ({ useTheme: () => ({}), type: { small: 12 } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update = { kind: "ready", version: "0.10.0" };
  mocks.offer = { version: "0.10.0", url: "https://example.test/Relay.apk", sha512: "checksum" };
});

function tap() {
  const banner = UpdateBanner() as ReactElement<{ onPress: () => void }>;
  expect(banner).not.toBeNull();
  banner.props.onPress();
}

it("installs the same-version APK instead of asking for a bundle restart and then an APK", () => {
  tap();
  expect(mocks.install).toHaveBeenCalledWith(mocks.offer);
  expect(mocks.restart).not.toHaveBeenCalled();
});

it("installs the newer public APK when a desktop bundle is ready", () => {
  mocks.offer!.version = "0.11.0";
  tap();
  expect(mocks.install).toHaveBeenCalledWith(mocks.offer);
  expect(mocks.restart).not.toHaveBeenCalled();
});

it("still restarts a ready desktop bundle when there is no suitable APK", () => {
  mocks.offer = undefined;
  tap();
  expect(mocks.restart).toHaveBeenCalledTimes(1);
  expect(mocks.install).not.toHaveBeenCalled();
});

it("still offers the desktop's newer APK over an older public one", () => {
  mocks.update = { kind: "apk", version: "0.11.0", url: "https://example.test/newer.apk" };
  tap();
  expect(mocks.install).toHaveBeenCalledWith(mocks.update);
  expect(mocks.restart).not.toHaveBeenCalled();
});
