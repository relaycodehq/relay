import { afterEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { pasteMarkdown } from "../../../shared/pasted-texts";
import { promptContent } from "./prompt-content";
import { promptText, typedText } from "./prompt-text";
import { replaceText } from "./prompt/edits";
import { promptExtensions } from "./prompt/extensions";
import { ultrathinkEdits } from "./ultrathink";

const editors: Editor[] = [];

afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

/** Toggles the keyword in an editor holding `text` the way the composer's switch does. */
function toggled(text: string, files: string[] = []) {
  const editor = new Editor({
    element: null,
    extensions: promptExtensions(),
    content: promptContent(text, {}, [], files),
  });
  editors.push(editor);
  const { doc } = editor.state;
  for (const edit of ultrathinkEdits(promptText(doc), typedText(doc)))
    replaceText(editor, edit);
  return promptText(editor.state.doc);
}

it("turns off the typed keyword after a file pill whose path has the word", () => {
  const path = "src/ultrathink.ts";
  expect(toggled("look at `src/ultrathink.ts` please ultrathink", [path])).toBe(
    "look at `src/ultrathink.ts` please",
  );
});

it("leaves a paste pill's text and the typed words around it alone", () => {
  const paste = pasteMarkdown({ n: 1, text: "ultrathink\nlog" });
  const draft = `see${paste}then ultrathink`;
  expect(toggled(draft)).toBe(`see${paste}then`);
});

it("adds the keyword when it's only in a pill, and takes the typed one back out", () => {
  const paste = pasteMarkdown({ n: 1, text: "ultrathink\nlog" });
  const draft = `see${paste}`;
  expect(toggled(draft)).toBe(`see${paste}ultrathink`);
  expect(toggled(toggled(draft))).toBe(`see${paste}`);
});
