import { expect, it } from "vitest";
import { changedWhole } from "./added-lines";

const changedIn = (from: number, to: number) => (at: number) => at >= from && at < to;

it("calls a line rewritten whole when only its punctuation is left", () => {
  expect(changedWhole("  foo(bar);", changedIn(2, 10))).toBe(true);
  expect(changedWhole("  foo(bar);", changedIn(2, 5))).toBe(false);
});

it("marks part of a line of punctuation alone as changed, not all of it", () => {
  expect(changedWhole("});", changedIn(0, 1))).toBe(false);
  expect(changedWhole("  });", changedIn(2, 5))).toBe(true);
});
