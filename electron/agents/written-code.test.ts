import { expect, it } from "vitest";
import { codexWritten } from "./written-code";

it("keeps a Codex file added whole, a deleted one as removed and an update as its diff", () => {
  expect(
    codexWritten([
      { path: "new.ts", kind: { type: "add" }, diff: "export {};" },
      { path: "old.ts", kind: { type: "delete" }, diff: "gone" },
      { path: "a.ts", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-a\n+b" },
    ]),
  ).toEqual([
    { kind: "whole", path: "new.ts", content: "export {};" },
    { kind: "swap", path: "old.ts", edits: [{ old: "gone", new: "" }], deleted: true },
    { kind: "patch", path: "a.ts", diff: "@@ -1 +1 @@\n-a\n+b" },
  ]);
});
