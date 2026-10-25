import { afterEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { promptExtensions } from "./extensions";
import { promptContent } from "../prompt-content";
import { beginDictation, endDictation, updateDictation } from "./dictation";

const editors: Editor[] = [];

// Unmounted, so the plugins go in by hand, as in prompt-limit.test.ts.
const draft = (text: string) => {
  const editor = new Editor({
    element: null,
    extensions: promptExtensions(),
    content: promptContent(text, {}),
  });
  editor.view.updateState(
    editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
  );
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editors.push(editor);
  return editor;
};

afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

const select = (editor: Editor, word: string) => {
  const from = editor.state.doc.textContent.indexOf(word) + 1;
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, from + word.length),
    ),
  );
};

const selected = (editor: Editor) =>
  editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
  );

it("keeps a selection in the dictated words as more are heard", () => {
  const editor = draft("");
  beginDictation(editor);
  updateDictation(editor, "hello brave new", "world");
  select(editor, "brave");
  updateDictation(editor, "hello brave new world", "and");
  expect(editor.state.doc.textContent).toBe("Hello brave new world and");
  expect(selected(editor)).toBe("brave");
});

it("keeps an edit to a settled word and dictates on after it", () => {
  const editor = draft("");
  beginDictation(editor);
  updateDictation(editor, "hello brave new", "world");
  select(editor, "brave");
  editor.view.dispatch(editor.state.tr.insertText("shiny"));
  updateDictation(editor, "hello brave new world", "and");
  expect(editor.state.doc.textContent).toBe("Hello shiny new world and");
  endDictation(editor, "hello brave new world and more");
  expect(editor.state.doc.textContent).toBe("Hello shiny new world and more");
});

it("takes back only the words still being dictated when discarded", () => {
  const editor = draft("");
  beginDictation(editor);
  updateDictation(editor, "hello brave new", "world");
  select(editor, "brave");
  editor.view.dispatch(editor.state.tr.insertText("shiny"));
  updateDictation(editor, "hello brave new world", "and");
  endDictation(editor, null);
  expect(editor.state.doc.textContent).toBe("Hello shiny new ");
});

const dictateOver = (text: string, word: string, heard: string | null) => {
  const editor = draft(text);
  select(editor, word);
  beginDictation(editor);
  if (heard) updateDictation(editor, "", heard);
  endDictation(editor, heard);
  return editor;
};

it("replaces a selected word as one undo step", () => {
  const editor = dictateOver("Hello brave new world", "brave", "Shiny.");
  expect(editor.state.doc.textContent).toBe("Hello shiny new world");
  editor.commands.undo();
  expect(editor.state.doc.textContent).toBe("Hello brave new world");
});

it("puts a selected word back when dictating over it is discarded", () => {
  const editor = dictateOver("Hello brave new world", "brave", null);
  expect(editor.state.doc.textContent).toBe("Hello brave new world");
});

it("keeps a selected word undoable after an edit made while dictating over it", () => {
  const editor = draft("Say brave words");
  select(editor, "brave");
  beginDictation(editor);
  updateDictation(editor, "Shiny new.", "");
  select(editor, "new");
  editor.view.dispatch(editor.state.tr.insertText("old"));
  updateDictation(editor, "Shiny new.", "And more");
  endDictation(editor, "Shiny new. And more.");
  expect(editor.state.doc.textContent).toBe("Say shiny old and more words");
  editor.commands.undo();
  expect(editor.state.doc.textContent).toContain("brave");
});
