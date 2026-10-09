import { expect, it } from "vitest";
import { offsetAfterResize, scrollAnchor } from "../../mobile/src/screens/scroll-anchor";

it("anchors above a streaming answer instead of on its fixed bottom edge", () => {
  expect(scrollAnchor([{ status: "streaming" }, { status: "complete" }])).toBe(1);
});

it("keeps the anchor above the answer while a newer steer awaits acknowledgement", () => {
  expect(scrollAnchor([
    { status: "complete" },
    { status: "streaming" },
    { status: "complete" },
  ])).toBe(2);
});

it("uses the permanent footer when the only message is streaming", () => {
  expect(scrollAnchor([{ status: "streaming" }])).toBe(1);
});

it("does not compensate for an older growing root above the active reply", () => {
  expect(scrollAnchor([
    { status: "streaming" },
    { status: "complete" },
    { status: "streaming" },
    { status: "complete" },
  ])).toBe(1);
});

it("keeps the same anchor when Load earlier adds messages at the older end", () => {
  expect(scrollAnchor([
    { status: "streaming" },
    { status: "complete" },
    ...Array.from({ length: 100 }, () => ({ status: "complete" as const })),
  ])).toBe(1);
});

it("moves the anchor back when a newer steer is removed", () => {
  expect(scrollAnchor([{ status: "complete" }, { status: "streaming" }])).toBe(2);
  expect(scrollAnchor([{ status: "streaming" }])).toBe(1);
});

it("keeps a footer anchor after a single answer finishes, and for an empty list", () => {
  expect(scrollAnchor([{ status: "complete" }])).toBe(1);
  expect(scrollAnchor([])).toBe(0);
});

it("lets the bottom follow through keyboard and composer resizes", () => {
  expect(offsetAfterResize(0, 700, 450)).toBeUndefined();
  expect(offsetAfterResize(48, 700, 450)).toBeUndefined();
});

it("holds the text's screen position when the keyboard opens and closes", () => {
  const original = { height: 700, offset: 500, textTop: 1000 };
  const shorter = 450;
  const offset = offsetAfterResize(original.offset, original.height, shorter)!;
  expect(shorter - original.textTop + offset).toBe(
    original.height - original.textTop + original.offset,
  );
  expect(offsetAfterResize(offset, shorter, original.height)).toBe(original.offset);
});

it("compensates returning from a real zero-height viewport", () => {
  expect(offsetAfterResize(500, 300, 0)).toBe(800);
  expect(offsetAfterResize(800, 0, 300)).toBe(500);
});

it("does not scroll on initial measurement or an unchanged height", () => {
  expect(offsetAfterResize(500, undefined, 700)).toBeUndefined();
  expect(offsetAfterResize(500, 700, 700)).toBeUndefined();
});

it("clamps a growing viewport to the bottom when there is no more space", () => {
  expect(offsetAfterResize(100, 400, 700)).toBe(0);
});
