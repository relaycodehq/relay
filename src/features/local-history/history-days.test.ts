import { expect, it } from "vitest";
import type { LocalHistoryEntry } from "../../../shared/local-history";
import { groupByDay, sizeText } from "./history-days";

const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h).getTime();
const entry = (time: number): LocalHistoryEntry => ({
  id: String(time),
  time,
  reason: "save",
  size: 1,
  hash: "0".repeat(64),
});

it("groups newest-first entries under their local day", () => {
  const now = at(2026, 10, 25, 15);
  const groups = groupByDay(
    [
      entry(at(2026, 10, 25, 14)),
      entry(at(2026, 10, 25, 9)),
      entry(at(2026, 10, 24, 23)),
      entry(at(2026, 10, 22)),
      entry(at(2026, 10, 1)),
      entry(at(2025, 12, 31)),
    ],
    now,
  );
  // Past yesterday the titles are in the user's locale: only that a year shows once it isn't this one.
  expect(groups.map((g) => g.entries.length)).toEqual([2, 1, 1, 1, 1]);
  expect(groups.slice(0, 2).map((g) => g.title)).toEqual([
    "Today",
    "Yesterday",
  ]);
  expect(groups[2]!.title).not.toMatch(/\d/);
  expect(groups[3]!.title).not.toContain("2026");
  expect(groups[4]!.title).toContain("2025");
});

it("writes sizes the short way", () => {
  expect(sizeText(512)).toBe("512 B");
  expect(sizeText(2048)).toBe("2.0 KB");
  expect(sizeText(300 * 1024)).toBe("300 KB");
  expect(sizeText(5 * 1024 * 1024)).toBe("5.0 MB");
});
