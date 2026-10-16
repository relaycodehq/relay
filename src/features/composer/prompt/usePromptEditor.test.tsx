// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorContent, type Editor } from "@tiptap/react";
import { DOMSerializer } from "@tiptap/pm/model";
import { copiedImages } from "../../images/image-clipboard";
import { showImages } from "./image-pill";
import { promptContent } from "../prompt-content";
import { promptText } from "../prompt-text";
import type { DraftPills } from "../useDraftPills";
import { usePromptEditor, type PromptEvents } from "./usePromptEditor";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => act(() => roots.splice(0).forEach((root) => root.unmount())));

const pills = { content: (text: string) => promptContent(text, {}) };

function mount(value: string, events: PromptEvents) {
  let editor: Editor | null = null;
  function Prompt() {
    const input = useRef<HTMLElement>(null);
    editor = usePromptEditor(value, "", pills as DraftPills, events, input);
    return <EditorContent editor={editor} />;
  }
  const root = createRoot(
    document.body.appendChild(document.createElement("div")),
  );
  roots.push(root);
  act(() => root.render(<Prompt />));
  return () => editor!;
}

const paste = (editor: Editor, text: string) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(event, {
    clipboardData: {
      files: [],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
  act(() => void editor.view.dom.dispatchEvent(event));
};

it("says so when a paste doesn't fit the message, instead of dropping it unseen", () => {
  const onPasteRefused = vi.fn();
  const editor = mount("a".repeat(31_990), {
    onChange: () => {},
    onCursor: () => {},
    onPasteRefused,
  });
  paste(editor(), "b".repeat(10));
  expect(promptText(editor().state.doc).length).toBe(32_000);
  expect(onPasteRefused).not.toHaveBeenCalled();
  paste(editor(), "c");
  expect(promptText(editor().state.doc).length).toBe(32_000);
  expect(onPasteRefused).toHaveBeenCalledOnce();
});

it("keeps quiet about a paste with no plain text, which has nothing to turn away", () => {
  const onPasteRefused = vi.fn();
  const editor = mount("draft", {
    onChange: () => {},
    onCursor: () => {},
    onPasteRefused,
  });
  paste(editor(), "");
  expect(promptText(editor().state.doc)).toBe("draft");
  expect(onPasteRefused).not.toHaveBeenCalled();
});

it("copies a screenshot pill with its screenshot, so another draft gets the picture too", () => {
  const editor = mount("look at [Image #1] here", {
    onChange: () => {},
    onCursor: () => {},
  })();
  const png = "data:image/png;base64,iVBORw0KGgo=";
  act(() =>
    showImages(editor, [{ n: 1, name: "shot.png", src: png, bytes: 8 }]),
  );
  // What ProseMirror puts on the clipboard as HTML.
  const html = document.createElement("div");
  html.append(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(
      editor.state.doc.content,
    ),
  );
  expect(
    copiedImages(html.innerHTML).map(({ n, file, src }) => [n, file.name, src]),
  ).toEqual([[1, "shot.png", png]]);
});
