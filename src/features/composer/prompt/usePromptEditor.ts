import { useEditor, type UseEditorOptions } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { useEffect, useRef, useState, type RefObject } from "react";
import { pasteIndex, removePill } from "../prompt-pills";
import { promptText, serialize } from "../prompt-text";
import { pasteText } from "./edits";
import type { DraftPills } from "../useDraftPills";
import { promptExtensions } from "./extensions";

export interface PromptEvents {
  onChange: (value: string) => void;
  /** The caret's offset in the draft's text. */
  onCursor: (pos: number) => void;
  /** Opens the nth paste pill's text. */
  onOpenPaste?: (index: number) => void;
  /** Opens screenshot n, from its pill. */
  onOpenImage?: (n: number) => void;
  /** A paste the message can't hold was turned away. */
  onPasteRefused?: () => void;
}

/**
 * The editor showing the draft, made with `value` and reporting each edit and
 * caret move as text. Pasted and copied text keeps its pills; clicking a pill
 * opens it, or removes it from its ×.
 */
export function usePromptEditor(
  value: string,
  placeholder: string,
  pills: DraftPills,
  events: PromptEvents,
  inputRef: RefObject<HTMLElement | null>,
) {
  const callbacks = useRef(events);
  callbacks.current = events;
  // Built once: the editor only reads these when it is made, and options that
  // differ on a render make useEditor reset the view's props on every keystroke.
  const [options] = useState<UseEditorOptions>(() => ({
    extensions: promptExtensions(),
    content: pills.content(value),
    // The composer remounts per thread, so opening one lands in its input.
    autofocus: "end",
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Message project",
        "aria-multiline": "true",
        class: "composer-prompt-input",
        "data-placeholder": placeholder,
      },
      handlePaste(view, event) {
        if (event.clipboardData?.files.length) return false;
        const plain = event.clipboardData?.getData("text/plain");
        if (plain === undefined) return false;
        // An empty clipboard changes nothing either, but isn't too long.
        if (!pasteText(view, pills, plain) && plain)
          callbacks.current.onPasteRefused?.();
        return true;
      },
      clipboardTextSerializer: (slice) => serialize(slice.content),
      // A pill's × removes it; elsewhere a screenshot or paste opens.
      handleClickOn(view, _pos, node, nodePos, event) {
        if (
          event.target instanceof Element &&
          event.target.closest(".prompt-pill-remove")
        ) {
          view.dispatch(
            closeHistory(
              removePill(view.state.tr, nodePos, node),
            ).scrollIntoView(),
          );
          return true;
        }
        if (node.type.name === "relayImage") {
          callbacks.current.onOpenImage?.(node.attrs.n);
          return true;
        }
        if (node.type.name === "relayPaste") {
          callbacks.current.onOpenPaste?.(pasteIndex(view.state.doc, nodePos));
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      callbacks.current.onCursor(
        promptText(editor.state.doc, editor.state.selection.from).length,
      );
      callbacks.current.onChange(promptText(editor.state.doc));
    },
    onSelectionUpdate({ editor }) {
      callbacks.current.onCursor(
        promptText(editor.state.doc, editor.state.selection.from).length,
      );
    },
  }));
  const editor = useEditor(options);
  useEffect(() => {
    if (!editor) return;
    inputRef.current = editor.view.dom;
    return () => {
      inputRef.current = null;
    };
  }, [editor, inputRef]);
  return editor;
}
