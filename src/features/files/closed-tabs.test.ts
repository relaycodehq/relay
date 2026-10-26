import { describe, expect, it } from "vitest";
import {
  MAX_CLOSED,
  nextToReopen,
  rememberClosed,
  tabsGone,
  type ClosedTab,
} from "./closed-tabs";
import { openIn, singleGroup, split } from "./editor-groups";

const closed = (group: string, ...paths: string[]): ClosedTab[] =>
  paths.map((path) => ({ tab: { path }, group }));
const paths = (stack: ClosedTab[]) => stack.map((c) => c.tab.path);

describe("closed tabs", () => {
  it("puts the last closed first", () => {
    const stack = rememberClosed(closed("g", "a"), closed("g", "b", "c"));
    expect(paths(stack)).toEqual(["c", "b", "a"]);
  });

  it("lists a file closed again once, on top", () => {
    const stack = rememberClosed(closed("g", "b", "a"), closed("g", "a"));
    expect(paths(stack)).toEqual(["a", "b"]);
  });

  it("remembers a file closed in two splits for each", () => {
    const stack = rememberClosed(closed("left", "a"), closed("right", "a"));
    expect(stack).toHaveLength(2);
  });

  it("forgets the oldest past the limit", () => {
    const many = closed(
      "g",
      ...Array.from({ length: MAX_CLOSED + 3 }, (_, i) => `f${i}`),
    );
    const stack = rememberClosed([], many);
    expect(stack).toHaveLength(MAX_CLOSED);
    expect(stack[0].tab.path).toBe(`f${MAX_CLOSED + 2}`);
  });

  it("finds what a tab-opening made room by closing", () => {
    expect(
      tabsGone([{ path: "a" }, { path: "b" }], [{ path: "b" }, { path: "c" }]),
    ).toEqual([{ path: "a" }]);
  });
});

describe("reopening", () => {
  const base = openIn(openIn(singleGroup(), { path: "a" }), { path: "b" });
  const left = base.focused;

  it("goes back to the split the tab was in", () => {
    const layout = split(base, left);
    const next = nextToReopen(closed(left, "x"), layout)!;
    expect(next.group).toBe(left);
    expect(next.rest).toEqual([]);
  });

  it("uses the focused split when the old one is gone", () => {
    const next = nextToReopen(closed("gone", "x"), base)!;
    expect(next.group).toBe(left);
  });

  it("skips tabs already open there, dropping them from the stack", () => {
    const stack = [...closed(left, "b"), ...closed(left, "x", "y")];
    const next = nextToReopen(stack, base)!;
    expect(next.tab.path).toBe("x");
    expect(paths(next.rest)).toEqual(["y"]);
  });

  it("has nothing when everything is open", () => {
    expect(nextToReopen(closed(left, "a", "b"), base)).toBeUndefined();
    expect(nextToReopen([], base)).toBeUndefined();
  });
});
