import { afterEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { promptExtensions } from "../../src/components/composer-prompt/extensions";
import { syncDraft } from "../../src/components/composer-prompt/usePromptSync";
import { promptContent } from "../../src/lib/prompt-content";
import { promptText } from "../../src/lib/prompt-text";

const content = (text: string) => promptContent(text, {});
const editors: Editor[] = [];
// Unmounted, as there is no DOM here. Tiptap installs the plugins only as it
// mounts, so they go in by hand; the limit is one of them.
const draft = (text: string) => {
  const editor = new Editor({
    element: null,
    extensions: promptExtensions(),
    content: content(text),
  });
  editor.view.updateState(
    editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
  );
  editors.push(editor);
  return editor;
};
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
const type = (editor: Editor, from: number, text: string, to = from) =>
  editor.view.dispatch(editor.state.tr.insertText(text, from, to));

it("stops typing at 32,000 characters", () => {
  const editor = draft("a".repeat(31999));
  type(editor, 1, "b");
  expect(promptText(editor.state.doc).length).toBe(32000);
  type(editor, 1, "c");
  expect(promptText(editor.state.doc).length).toBe(32000);
});

it("shows a draft set past the limit from outside rather than keeping the old text", () => {
  const editor = draft("start");
  const restored = `start\n\n${"q".repeat(32000)}`;
  syncDraft(editor, restored, content);
  expect(promptText(editor.state.doc)).toBe(restored);
});

it("lets a draft over the limit be shortened and the caret moved, but not grown", () => {
  const editor = draft("x".repeat(32010));
  const { doc } = editor.state;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(doc, 5)),
  );
  expect(editor.state.selection.from).toBe(5);
  editor.commands.deleteRange({ from: 1, to: 11 });
  expect(promptText(editor.state.doc).length).toBe(32000);
  editor.commands.deleteRange({ from: 1, to: 3 });
  type(editor, 1, "a");
  expect(promptText(editor.state.doc).length).toBe(31999);
});

it("does not let typing grow a draft that is already over the limit", () => {
  const editor = draft("x".repeat(32010));
  type(editor, 1, "a");
  expect(promptText(editor.state.doc).length).toBe(32010);
  // Typing over a selection that it does not outgrow still goes in.
  type(editor, 1, "ab", 3);
  expect(promptText(editor.state.doc)).toMatch(/^abx/);
});
