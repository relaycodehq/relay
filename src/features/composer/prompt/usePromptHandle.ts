import type { Editor } from "@tiptap/core";
import { useImperativeHandle, type Ref } from "react";
import type { DictationTarget } from "../../dictation/audio/session";
import { quotesIn } from "../prompt-pills";
import type { DraftEditor } from "../useComposerDraft";
import type { DraftPills } from "../useDraftPills";
import { beginDictation, endDictation, updateDictation } from "./dictation";
import {
  caretOffsets,
  inlinePaste,
  insertPaste,
  insertMention,
  insertQuote,
  insertSkill,
  insertTags,
  removeImage,
  removePaste,
  replaceDraft,
  replaceText,
  type SkillPick,
} from "./edits";

export interface PromptInputHandle extends DraftEditor {
  insertSkill: (skill: SkillPick) => void;
  /** Puts a file in, by its path in the project, in place of `start`–`end`. */
  insertMention: (path: string, range: { start: number; end: number }) => void;
  /** Puts a quoted passage at the caret as a pill. */
  insertQuote: (text: string) => void;
  /** Focuses the draft with the caret at its end. */
  focusEnd: () => void;
  /** Drops the nth paste pill. */
  removePaste: (index: number) => void;
  /** Swaps the nth paste pill for its text. */
  inlinePaste: (index: number) => void;
  /** Where dictated words go: live at the caret, greyed while they may still change. */
  dictation: DictationTarget;
  /** The selection's ends in the draft's text; equal for a bare caret. */
  caret: () => { start: number; end: number } | undefined;
  /** Shows `text` as the whole draft, caret at its end; what the draft and caret are then. */
  replace: (text: string) => { text: string; caret: number } | undefined;
}

/** What the composer may do to the draft in the editor, besides typing. */
export function usePromptHandle(
  handleRef: Ref<PromptInputHandle>,
  editor: Editor | null,
  draftKey: string,
  pills: DraftPills,
) {
  useImperativeHandle(
    handleRef,
    () => ({
      insertSkill(pick) {
        if (!editor) return;
        pills.addSkill(pick.token, pick.label);
        insertSkill(editor, pick);
      },
      insertMention(path, range) {
        if (!editor) return;
        pills.addFiles([path]);
        insertMention(editor, { path, ...range });
      },
      insertText(range) {
        if (editor) replaceText(editor, range);
      },
      insertFiles(paths, point) {
        if (!editor || !paths.length) return;
        pills.addFiles(paths);
        insertTags(
          editor,
          paths.map((path) => ({ type: "relayFile", attrs: { path } })),
          point,
        );
      },
      insertImages(ns, point) {
        if (!editor || !ns.length) return;
        insertTags(
          editor,
          ns.map((n) => ({ type: "relayImage", attrs: { n } })),
          point,
        );
      },
      removeImage(n) {
        if (editor) removeImage(editor, n);
      },
      insertQuote(quote) {
        if (!editor || !quote) return;
        pills.setQuotes([...new Set([...quotesIn(editor.state.doc), quote])]);
        insertQuote(editor, quote);
      },
      insertPaste: (pasted) => !!editor && insertPaste(editor, pasted),
      focusEnd: () => void editor?.commands.focus("end"),
      removePaste(index) {
        if (editor) removePaste(editor, index);
      },
      inlinePaste(index) {
        if (editor) inlinePaste(editor, index);
      },
      caret: () => (editor ? caretOffsets(editor) : undefined),
      replace: (text) =>
        editor ? replaceDraft(editor, pills.content(text)) : undefined,
      dictation: {
        begin: () => editor?.isDestroyed === false && beginDictation(editor),
        update: (settled, tentative) =>
          editor?.isDestroyed === false &&
          updateDictation(editor, settled, tentative),
        end: (text) =>
          editor?.isDestroyed === false && endDictation(editor, text),
      },
    }),
    [editor, draftKey],
  );
}
