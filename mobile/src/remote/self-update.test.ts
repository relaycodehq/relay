import { beforeEach, expect, it, vi } from "vitest";
import type { PhoneAppRelease } from "../../../shared/remote";

// The APK runs 0.9.0 on native runtime R1.
const native = vi.hoisted(() => ({
  running: null as string | null,
  failed: null as string | null,
  confirm: () => {},
  begin: async () => {},
  append: async () => {},
  commit: async (_version: string, _files: unknown) => {},
  clear: async () => {},
}));
vi.mock("expo", () => ({
  requireOptionalNativeModule: () => native,
  reloadAppAsync: async () => {},
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "0.9.0", extra: { relayRuntime: "R1" } } },
}));
vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));

const offer = (version: string, runtime = "R1"): PhoneAppRelease => ({
  version,
  runtime,
  bundle: "index.bundle",
  files: [{ path: "index.bundle", size: 3, sha256: "0".repeat(64) }],
});
const chunk = async () => "AAAA";

let selfUpdate: typeof import("./self-update");
beforeEach(async () => {
  vi.resetModules();
  selfUpdate = await import("./self-update");
});

it("drops the 'needs a new app' banner back on a computer whose code this phone runs", async () => {
  const { checkForUpdate, useSelfUpdate } = selfUpdate;
  await checkForUpdate(offer("0.10.3", "R2"), chunk);
  expect(useSelfUpdate()).toMatchObject({ kind: "apk", version: "0.10.3", runtime: "R2" });
  await checkForUpdate(offer("0.9.0"), chunk);
  expect(useSelfUpdate().kind).toBe("none");
});

it("keeps a staged update over an older computer's code, and shows it again after one that needs an APK", async () => {
  const { checkForUpdate, pendingVersion, useSelfUpdate } = selfUpdate;
  const commits: string[] = [];
  native.commit = async (version) => void commits.push(version);
  await checkForUpdate(offer("0.10.1"), chunk);
  expect(useSelfUpdate()).toMatchObject({ kind: "ready", version: "0.10.1" });
  // Switched to a computer on 0.10.0 before restarting.
  await checkForUpdate(offer("0.10.0"), chunk);
  expect(commits).toEqual(["0.10.1"]);
  expect(useSelfUpdate()).toMatchObject({ kind: "ready", version: "0.10.1" });
  // Then to one that needs a new APK, and back.
  await checkForUpdate(offer("0.11.0", "R2"), chunk);
  expect(useSelfUpdate().kind).toBe("apk");
  expect(pendingVersion()).toBe("0.10.1");
  await checkForUpdate(offer("0.10.1"), chunk);
  expect(useSelfUpdate()).toMatchObject({ kind: "ready", version: "0.10.1" });
  expect(commits).toEqual(["0.10.1"]);
});
