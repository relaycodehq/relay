import { afterEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { pasteMarkdown } from "../../../../shared/pasted-texts";
import { promptContent } from "../prompt-content";
import { promptText } from "../prompt-text";
import type { DraftPills } from "../useDraftPills";
import {
  caretOffsets,
  insertPaste,
  insertQuote,
  pasteText,
  replaceDraft,
} from "./edits";
import { promptExtensions } from "./extensions";

const editors: Editor[] = [];

afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

/** An unmounted editor reporting its edits and caret moves as the composer hears them. */
function draft(text: string) {
  const heard: { text?: string; caret?: number } = {};
  const editor = new Editor({
    element: null,
    extensions: promptExtensions(),
    content: promptContent(text, {}),
    onUpdate: ({ editor }) => {
      heard.text = promptText(editor.state.doc);
    },
    onSelectionUpdate: ({ editor }) => {
      heard.caret = caretOffsets(editor).start;
    },
  });
  editors.push(editor);
  return { editor, heard };
}

it("shows a recalled message whole, caret at its end, and says so as an edit", () => {
  const { editor, heard } = draft("");
  const paste = pasteMarkdown({ n: 1, text: "a\nlog" });
  const message = `look at this${paste}`.trim();
  const shown = replaceDraft(editor, promptContent(message, {}));
  // A paste pill gives its blank lines back, so the text is read off the editor.
  expect(shown.text.trim()).toBe(message);
  expect(shown.caret).toBe(shown.text.length);
  expect(heard).toEqual(shown);
  // The paste came back as its pill, not as the fence typed out.
  let pills = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "relayPaste") pills++;
  });
  expect(pills).toBe(1);
  expect(caretOffsets(editor)).toEqual({
    start: shown.text.length,
    end: shown.text.length,
  });
});

/** What follows the draft's last pill, and whether the saved text brings it back the same. */
function afterPill(editor: Editor) {
  const nodes: string[] = [];
  editor.state.doc.firstChild!.forEach((node) =>
    nodes.push(node.isText ? node.text! : node.type.name),
  );
  const text = promptText(editor.state.doc);
  const restored = draft(text).editor;
  expect(promptText(restored.state.doc)).toBe(text);
  return nodes;
}

it("leaves a space after a pasted pill to type on, but not a second one", () => {
  const { editor } = draft("see");
  editor.commands.setTextSelection(4);
  insertPaste(editor, "a\nlog");
  insertQuote(editor, "the cache tweak");
  expect(afterPill(editor)).toEqual([
    "see",
    "relayPaste",
    " ",
    "relayQuote",
    " ",
  ]);

  const before = draft("look  here").editor;
  before.commands.setTextSelection(6);
  insertPaste(before, "a\nlog");
  expect(afterPill(before)).toEqual(["look ", "relayPaste", " here"]);
});

it("leaves a space after pasted text that ends in a pill", () => {
  const { editor } = draft("");
  const pills = {
    content: (text: string) => promptContent(text, {}, [], ["/tmp/a.md"]),
  } as DraftPills;
  pasteText(editor.view, pills, "read `/tmp/a.md`");
  expect(afterPill(editor)).toEqual(["read ", "relayFile", " "]);
});
