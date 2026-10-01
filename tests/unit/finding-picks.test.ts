import { expect, it } from "vitest";
import {
  findingStatus,
  firstPicks,
  fixAllLabel,
} from "../../src/lib/finding-picks";
import type { Finding } from "../../shared/deep-review";

const finding = (id: string, priority: Finding["priority"]): Finding => ({
  id,
  priority,
  title: id,
  files: [],
  reviewers: [],
});

it("ticks P0 and P1 to start with", () => {
  expect(
    firstPicks([
      finding("F1", "P0"),
      finding("F2", "P2"),
      finding("F3", "P1"),
      finding("F4", "P3"),
    ]),
  ).toEqual(["F1", "F3"]);
});

it("says whether Fix all fixes everything or what's left", () => {
  expect(fixAllLabel(0, 3)).toBe("Fix all");
  expect(fixAllLabel(3, 3)).toBe("Fix all 3");
  expect(fixAllLabel(2, 3)).toBe("Fix the other 2");
  expect(findingStatus(undefined, "F1")).toBe("open");
});
