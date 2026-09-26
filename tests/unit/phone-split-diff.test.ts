import { expect, it } from "vitest";
import { splitRows } from "../../mobile/src/remote/split-diff";
import type { RemoteDiffLine } from "../../shared/remote";

const same = (n: number, text: string): RemoteDiffLine => ({
  kind: "same",
  text,
  old: n,
  new: n,
});
const del = (old: number, text: string): RemoteDiffLine => ({
  kind: "del",
  text,
  old,
});
const add = (n: number, text: string): RemoteDiffLine => ({
  kind: "add",
  text,
  new: n,
});

const sides = (lines: RemoteDiffLine[]) =>
  splitRows({
    path: "a.ts",
    binary: false,
    truncated: false,
    hunks: [{ header: "@@ -1 +1 @@", lines }],
  }).map((r) =>
    r.kind === "hunk"
      ? r.header
      : [r.left?.text ?? null, r.right?.text ?? null],
  );

it("sets each removed line against the one that replaced it", () => {
  expect(
    sides([
      same(1, "a"),
      del(2, "b"),
      del(3, "c"),
      add(2, "B"),
      same(4, "d"),
      add(4, "e"),
    ]),
  ).toEqual([
    "@@ -1 +1 @@",
    ["a", "a"],
    ["b", "B"],
    ["c", null],
    ["d", "d"],
    [null, "e"],
  ]);
});

it("doesn't pair a removal with additions that came before it", () => {
  expect(sides([add(1, "new"), del(1, "old")])).toEqual([
    "@@ -1 +1 @@",
    [null, "new"],
    ["old", null],
  ]);
});
