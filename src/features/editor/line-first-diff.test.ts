import { expect, it } from "vitest";
import { presentableDiff, type Change } from "@codemirror/merge";
import { lineFirstDiff } from "./line-first-diff";

/** A long file edited all through: lines reworded, removed and added every few dozen. */
function editedThroughout() {
  const lines = Array.from({ length: 3000 }, (_, i) => `export const value${i} = ${i * 7};`);
  const edited = lines.flatMap((line, i) => {
    if (i % 60 === 30) return [];
    const kept = i % 25 === 10 ? `${line} // changed` : line;
    return i % 90 === 45 ? [kept, "// added here"] : [kept];
  });
  return { original: lines.join("\n") + "\n", edited: edited.join("\n") + "\n" };
}

const applied = (a: string, b: string, changes: readonly Change[]) => {
  let out = "";
  let at = 0;
  for (const change of changes) {
    out += a.slice(at, change.fromA) + b.slice(change.fromB, change.toB);
    at = change.toA;
  }
  return out + a.slice(at);
};

it("keeps edits all through a long file apart, where the merge view's own diff calls it all replaced", () => {
  const { original, edited } = editedThroughout();
  const mergeViewDefault = presentableDiff(original, edited, { scanLimit: 500 });
  expect(Math.max(...mergeViewDefault.map((change) => change.toA - change.fromA))).toBeGreaterThan(10_000);
  const changes = presentableDiff(original, edited, { override: lineFirstDiff });
  expect(changes.length).toBeGreaterThan(150);
  expect(changes.every((change) => change.toA - change.fromA < 40)).toBe(true);
  expect(applied(original, edited, changes)).toBe(edited);
});

it("narrows a changed line to the characters that changed", () => {
  const changes = lineFirstDiff("a\nconst total = 1;\nb\n", "a\nconst total = 2;\nb\n");
  expect(changes.map((c) => [c.fromA, c.toA, c.fromB, c.toB])).toEqual([[16, 17, 16, 17]]);
});

it("handles text without a final line break, and removed and added lines", () => {
  const a = "one\ntwo\nthree";
  const b = "zero\none\nthree\nfour";
  expect(applied(a, b, lineFirstDiff(a, b))).toBe(b);
});
