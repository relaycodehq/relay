import { useEditor, type UseEditorOptions } from "@tiptap/react";
import { Slice } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { useEffect, useRef, useState, type RefObject } from "react";
import { pastesAfter } from "../../../shared/pasted-texts";
import { pasteIndex } from "../../lib/prompt-pills";
import { promptText, serialize } from "../../lib/prompt-text";
import type { DraftPills } from "../../lib/useDraftPills";
import { promptExtensions } from "./extensions";

export interface PromptEvents {
  onChange: (value: string) => void;
  /** The caret's offset in the draft's text. */
  onCursor: (pos: number) => void;
  /** Opens the nth paste pill's text. */
  onOpenPaste?: (index: number) => void;
  /** Opens screenshot n, from its pill. */
  onOpenImage?: (n: number) => void;
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
        // A pill copied within the draft, or from another, gets a new number.
        const fragment = view.state.schema.nodeFromJSON(
          pills.content(pastesAfter(promptText(view.state.doc), plain)),
        ).firstChild!.content;
        view.dispatch(
          view.state.tr
            .replaceSelection(new Slice(fragment, 0, 0))
            .scrollIntoView(),
        );
        return true;
      },
      clipboardTextSerializer: (slice) => serialize(slice.content),
      // The × inside a quote or paste pill removes it; the pill itself stays an atom.
      handleClickOn(view, _pos, node, nodePos, event) {
        if (node.type.name === "relayImage") {
          callbacks.current.onOpenImage?.(node.attrs.n);
          return true;
        }
        if (
          node.type.name === "relayPaste" &&
          !(
            event.target instanceof Element &&
            event.target.closest(".composer-quote-remove")
          )
        ) {
          callbacks.current.onOpenPaste?.(pasteIndex(view.state.doc, nodePos));
          return true;
        }
        if (
          !["relayQuote", "relayPaste"].includes(node.type.name) ||
          !(event.target instanceof Element) ||
          !event.target.closest(".composer-quote-remove")
        )
          return false;
        view.dispatch(
          closeHistory(
            view.state.tr.delete(nodePos, nodePos + node.nodeSize),
          ).scrollIntoView(),
        );
        return true;
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
