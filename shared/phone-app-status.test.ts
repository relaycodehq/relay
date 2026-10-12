import { expect, it } from "vitest";
import { newerVersion, phoneAppStatus, type PhoneAppReport } from "./phone-app";

const app: PhoneAppReport = {
  version: "0.1.1",
  updated: true,
  apk: "0.1.0",
  updates: true,
};

it("says why a phone isn't on the desktop's version", () => {
  expect(phoneAppStatus(app, "0.1.1")).toBe("Up to date");
  expect(phoneAppStatus(app, "0.1.2")).toBe("0.1.2 not fetched yet");
  expect(phoneAppStatus({ ...app, failed: "0.1.2" }, "0.1.2")).toBe(
    "0.1.2 didn't start, so it stays on 0.1.1",
  );
  expect(phoneAppStatus({ ...app, updates: false }, "0.1.2")).toMatch(
    /development build/,
  );
  // Compared as versions, not text.
  expect(phoneAppStatus({ ...app, version: "0.10.0" }, "0.9.0")).toBe(
    "Newer than the 0.9.0 this Relay hands out",
  );
  expect(
    phoneAppStatus(
      { ...app, update: { kind: "apk", version: "0.2.0" } },
      "0.2.0",
    ),
  ).toMatch(/needs a new APK/);
});

it("puts a dev push after its release and before the next one", () => {
  expect(newerVersion("0.11.2.1760300000", "0.11.2")).toBe(true);
  expect(newerVersion("0.11.2.1760300001", "0.11.2.1760300000")).toBe(true);
  expect(newerVersion("0.11.3", "0.11.2.1760300000")).toBe(true);
  expect(newerVersion("0.11.2", "0.11.2.1760300000")).toBe(false);
});
