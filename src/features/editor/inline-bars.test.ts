// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { getChunks } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { inlineBars } from "./change-gutter";
import { lineChanges } from "./line-changes";
import { inlineChanges } from "./useEditorChanges";

// A test added between two others: it starts and ends like its neighbours, so
// the worker's diff and the merge view's slide it to different lines.
const opens = [
  '  it("opens beside the tab in front and brings an open one forward", () => {',
  '    let state = open("a", "b", "c");',
  '    state = openTab(state, { path: "a" });',
  '    expect(names(state)).toEqual(["a", "b", "c"]);',
  '    state = openTab(state, { path: "d" });',
  '    expect(names(state)).toEqual(["a", "d", "b", "c"]);',
  '    expect(state.active).toBe("d");',
  "  });",
];
const preview = [
  "  it(\"lets the next file looked at take a preview's place, until it's kept\", () => {",
  "    const look = (state: ReturnType<typeof open>, path: string) =>",
  "      openTab(state, { path, preview: true });",
  '    let state = look(look(open("a"), "b"), "c");',
  '    expect(names(state)).toEqual(["a", "c"]);',
  '    expect(state.recent).toEqual(["c", "a"]);',
  "    // Opened for keeps, or kept from its tab, a preview stays.",
  '    state = look(openTab(state, { path: "c" }), "d");',
  '    expect(names(state)).toEqual(["a", "c", "d"]);',
  '    state = look(keepTab(state, "d"), "e");',
  '    expect(names(state)).toEqual(["a", "c", "d", "e"]);',
  "    // An unsaved preview isn't replaced either.",
  '    const unsaved = (tab: EditorTab) => tab.path === "e";',
  '    state = openTab(state, { path: "f", preview: true }, unsaved);',
  '    expect(names(state)).toEqual(["a", "c", "d", "e", "f"]);',
  "    // Looking at a file already kept open doesn't make it a preview.",
  '    expect(look(state, "a").tabs[0].preview).toBeUndefined();',
  "  });",
];
const closing = [
  '  it("closing the tab in front goes back to the one before it", () => {',
  '    let state = open("a", "b", "c");',
];
// An edit above, as in the file this came from, keeps the start from being set aside.
const before = ["import { open } from \"./tabs\";", "", ...opens, "", ...closing].join("\n");
const after = ["import { keep, open } from \"./tabs\";", "", ...opens, "", ...preview, "", ...closing].join("\n");

it("draws the bars on the lines the inline changes tint", () => {
  const state = EditorState.create({
    doc: after,
    extensions: inlineChanges(before),
  });
  const lineAt = (pos: number) => state.doc.lineAt(pos).number;
  const tinted = getChunks(state)!.chunks.flatMap((chunk) => {
    const from = lineAt(chunk.fromB);
    const to = lineAt(Math.max(chunk.fromB, chunk.toB - 1));
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
  const bars: number[] = [];
  for (let cursor = state.field(inlineBars).iter(); cursor.value; cursor.next())
    bars.push(lineAt(cursor.from));
  expect(bars).toEqual(tinted);
  // The worker's own hunk for the new test starts a line earlier.
  const added = lineChanges(before, after).find((hunk) => hunk.added > 1)!;
  expect(tinted).toContain(added.line + added.added);
  expect(tinted).not.toContain(added.line);
});
