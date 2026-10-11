import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { UpdateBanner } from "./UpdateBanner";

const mocks = vi.hoisted(() => ({
  update: { kind: "ready", version: "0.10.0" } as { kind: string; version: string; runtime?: string; url?: string },
  offer: { version: "0.10.0", url: "https://example.test/Relay.apk", sha512: "checksum" } as
    { version: string; url: string; sha512: string; release?: string; runtime?: string } | undefined,
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
  mocks.update = { kind: "apk", version: "0.11.0", runtime: "R2", url: "https://example.test/newer.apk" };
  mocks.offer = { ...mocks.offer!, release: "0.10.0", runtime: "R1" };
  tap();
  expect(mocks.install).toHaveBeenCalledWith(mocks.update);
  expect(mocks.restart).not.toHaveBeenCalled();
});

it("installs the APK the desktop's release carried on, named after the desktop's version", () => {
  mocks.update = { kind: "apk", version: "0.10.3", runtime: "R2", url: "https://example.test/v0.10.3.apk" };
  mocks.offer = { release: "0.10.3", version: "0.10.1", runtime: "R2", url: "https://example.test/v0.10.3.apk", sha512: "checksum" };
  const banner = UpdateBanner() as ReactElement<{ onPress: () => void; children: ReactElement<{ children: string }> }>;
  expect(banner.props.children.props.children).toMatch(/^Relay 0\.10\.3 needs a new app; Older Relay/);
  banner.props.onPress();
  expect(mocks.install).toHaveBeenCalledWith(mocks.offer);
});
