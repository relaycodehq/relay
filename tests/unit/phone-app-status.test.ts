import { expect, it } from "vitest";
import { phoneAppStatus, type PhoneAppReport } from "../../shared/phone-app";

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
    phoneAppStatus({ ...app, update: { kind: "apk", version: "0.2.0" } }, "0.2.0"),
  ).toMatch(/needs a new APK/);
});
