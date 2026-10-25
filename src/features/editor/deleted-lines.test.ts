// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { inlineDiff } from "./deleted-lines";

// Lines unlike their neighbours, so the diff can't merge a removal into them.
const word = (i: number) => `${String.fromCharCode(97 + (i % 26)).repeat(3)}${i}`;
const original = Array.from({ length: 40 }, (_, i) => word(i)).join("\n");
// Lines 10 and 20 removed, line 30 reworded.
const edited = original
  .split("\n")
  .filter((_, i) => i !== 10 && i !== 20)
  .map((line, i) => (i === 28 ? "eee thirty" : line))
  .join("\n");

let view: EditorView | undefined;
afterEach(() => view?.destroy());

const open = () =>
  (view = new EditorView({ doc: edited, extensions: inlineDiff(original), parent: document.body }));
const deletedChunks = () => [...view!.dom.querySelectorAll(".cm-deletedChunk")];

it("shows each removed run of lines once, with the changed words marked", () => {
  open();
  expect(deletedChunks().map((chunk) => chunk.textContent)).toEqual([
    "kkk10",
    "uuu20",
    "eee30",
  ]);
  expect(deletedChunks()[2].querySelector(".cm-deletedText")).not.toBeNull();
});

// The merge view diffs again everything near an edit, which here is the whole document.
it("keeps removed lines drawn as they are while typing near them", () => {
  open();
  const before = deletedChunks();
  const at = view!.state.doc.line(5).to;
  view!.dispatch({ changes: { from: at, insert: " typed" } });
  // The typed line's old version joins them; the others are the same elements.
  expect(deletedChunks()).toHaveLength(before.length + 1);
  expect(before.every((chunk) => chunk.isConnected)).toBe(true);
});
