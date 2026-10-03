import { afterEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { pasteMarkdown } from "../../../../shared/pasted-texts";
import { promptContent } from "../prompt-content";
import { promptText } from "../prompt-text";
import { caretOffsets, replaceDraft } from "./edits";
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
