import { expect, it } from "vitest";
import { releasedBy, releaseTimes } from "./npm-release-age";

const day = 86_400_000;
const now = Date.parse("2026-10-09T09:00:00Z");

it("falls back to the newest old-enough stable release up to the tagged one, as npm does", () => {
  const times = releaseTimes({
    versions: {
      "1.0.0": {},
      "1.1.0": { deprecated: "broken" },
      "1.2.0-preview.0": {},
      "1.2.0": {},
      "1.3.0": {},
    },
    time: {
      created: "2026-01-01T00:00:00Z",
      "1.0.0": new Date(now - 30 * day).toISOString(),
      "1.1.0": new Date(now - 20 * day).toISOString(),
      "1.2.0-preview.0": new Date(now - 10 * day).toISOString(),
      "1.2.0": new Date(now - 1 * day).toISOString(),
      "1.3.0": new Date(now - 5 * day).toISOString(),
    },
  });

  expect(releasedBy(times, "1.2.0", 3, now)).toEqual({
    version: "1.0.0",
    held: { version: "1.2.0", until: now + 2 * day },
  });
  expect(releasedBy(times, "1.2.0", 0.5, now)).toEqual({ version: "1.2.0" });
});

it("falls back to an old-enough prerelease for a package that ships nothing else", () => {
  const amp = (seconds: number) => `0.0.${seconds}-g${seconds.toString(16)}`;
  const times = releaseTimes({
    versions: { [amp(100)]: {}, [amp(200)]: {}, [amp(300)]: {} },
    time: {
      [amp(100)]: new Date(now - 6 * day).toISOString(),
      [amp(200)]: new Date(now - 4 * day).toISOString(),
      [amp(300)]: new Date(now - 1 * day).toISOString(),
    },
  });

  expect(releasedBy(times, amp(300), 3, now).version).toBe(amp(200));
});
