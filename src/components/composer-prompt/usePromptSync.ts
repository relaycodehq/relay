import type { Editor } from "@tiptap/core";
import { useEffect, type HTMLAttributes } from "react";
import { promptText } from "../../lib/prompt-text";
import type { DraftPills } from "../../lib/useDraftPills";
import { showImages, type ImageChip } from "./image-pill";

/** Keeps the editor on the draft's text, its screenshots and the placeholder. */
export function usePromptSync(
  editor: Editor | null,
  value: string,
  pills: DraftPills,
  images: ImageChip[] | undefined,
  placeholder: string,
) {
  useEffect(() => {
    if (editor && promptText(editor.state.doc) !== value)
      editor.commands.setContent(pills.content(value), { emitUpdate: false });
  }, [value, editor]);
  useEffect(() => {
    if (editor) showImages(editor, images);
  }, [images, editor]);
  useEffect(() => {
    editor?.view.dom.setAttribute("data-placeholder", placeholder);
  }, [placeholder, editor]);
}

type Combobox = Pick<
  HTMLAttributes<HTMLElement>,
  | "aria-expanded"
  | "aria-controls"
  | "aria-activedescendant"
  | "aria-autocomplete"
>;

/** Makes the input a combobox while it shows a menu, with the menu's attributes. */
export function useComboboxRole(
  editor: Editor | null,
  expanded: Combobox["aria-expanded"],
  controls: Combobox["aria-controls"],
  activeId: Combobox["aria-activedescendant"],
  autocomplete: Combobox["aria-autocomplete"],
) {
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    dom.setAttribute("role", expanded ? "combobox" : "textbox");
    for (const [key, value] of Object.entries({
      "aria-expanded": expanded,
      "aria-controls": controls,
      "aria-activedescendant": activeId,
      "aria-autocomplete": autocomplete,
    })) {
      if (value === undefined) dom.removeAttribute(key);
      else dom.setAttribute(key, String(value));
    }
  }, [editor, expanded, controls, activeId, autocomplete]);
}
