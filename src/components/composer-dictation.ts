import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * The words being dictated: `from`–`to` in the draft, tentative from
 * `tentative` on, followed by `trail` characters of added spacing.
 */
interface Live {
  from: number;
  to: number;
  tentative: number;
  trail: number;
}

const key = new PluginKey<Live | null>("relayDictation");

export const ComposerDictation = Extension.create({
  name: "relayDictation",
  addProseMirrorPlugins() {
    return [
      new Plugin<Live | null>({
        key,
        state: {
          init: () => null,
          apply(tr, live) {
            const meta = tr.getMeta(key);
            if (meta !== undefined) return meta;
            if (!live || !tr.docChanged) return live;
            // Typing around the dictated words stays outside them.
            const from = tr.mapping.map(live.from, 1),
              to = Math.max(from, tr.mapping.map(live.to, -1));
            return {
              ...live,
              from,
              to,
              tentative: Math.min(
                to,
                Math.max(from, tr.mapping.map(live.tentative, -1)),
              ),
            };
          },
        },
        props: {
          decorations(state) {
            const live = key.getState(state);
            if (!live) return null;
            const decorations = [
              Decoration.widget(live.to, caret, {
                side: 1,
                key: "dictation-caret",
              }),
            ];
            if (live.tentative < live.to)
              decorations.push(
                Decoration.inline(live.tentative, live.to, {
                  class: "dictation-tentative",
                }),
              );
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

function caret() {
  const element = document.createElement("span");
  element.className = "dictation-caret";
  element.setAttribute("aria-hidden", "true");
  return element;
}

/**
 * The speech model starts every phrase with a capital, as if a sentence
 * began there. Mid-sentence it doesn't: "Please fix", not "Please Fix".
 */
export function fitCase(words: string, before: string) {
  const first = words.match(/^\p{L}[\p{L}']*/u)?.[0];
  if (!first) return words;
  const sentenceStart = !before.trim() || /[.!?…]["')\]]?\s*$/.test(before);
  if (sentenceStart) return words.charAt(0).toUpperCase() + words.slice(1);
  if (/^I('|$)/.test(first) || !/^\p{Lu}\p{Ll}*('\p{Ll}+)?$/u.test(first))
    return words;
  return words.charAt(0).toLowerCase() + words.slice(1);
}

/** The draft's text on the dictation's line before `from`. */
function lineBefore(state: EditorState, from: number) {
  const $from = state.doc.resolve(from);
  return state.doc.textBetween($from.start(), from, "\n", " ");
}

/** Spaces that keep dictated words apart from the text around them. */
function padding(state: EditorState, from: number, to: number) {
  const $from = state.doc.resolve(from),
    $to = state.doc.resolve(to);
  const before = $from.parentOffset
      ? state.doc.textBetween(from - 1, from, "\n", "￼")
      : "",
    after =
      $to.parentOffset < $to.parent.content.size
        ? state.doc.textBetween(to, to + 1, "\n", "￼")
        : "";
  return {
    lead: before && !/\s/.test(before) ? " " : "",
    trail: after && !/[\s.,!?;:)\]]/.test(after) ? " " : "",
  };
}

export function beginDictation(editor: Editor) {
  const { state } = editor;
  const { from, to } = state.selection;
  // Dictating over a selection replaces it, like typing does.
  const tr = state.tr.delete(from, to);
  editor.view.dispatch(
    closeHistory(
      tr.setMeta(key, { from, to: from, tentative: from, trail: 0 }),
    ),
  );
}

export function updateDictation(
  editor: Editor,
  settled: string,
  tentative: string,
) {
  const { state } = editor;
  const live = key.getState(state);
  if (!live) return;
  const words = fitCase(
    [settled, tentative].filter(Boolean).join(" "),
    lineBefore(state, live.from),
  );
  const end = live.to + live.trail;
  const { lead, trail } = padding(state, live.from, end);
  const text = words ? lead + words + trail : "";
  const following = state.selection.empty && state.selection.from === live.to;
  const tr = text
    ? state.tr.replaceWith(live.from, end, state.schema.text(text))
    : state.tr.delete(live.from, end);
  const to = live.from + text.length - trail.length;
  tr.setMeta(key, {
    from: live.from,
    to,
    tentative: tentative ? to - tentative.length : to,
    trail: text ? trail.length : 0,
  }).setMeta("addToHistory", false);
  if (following)
    tr.setSelection(TextSelection.create(tr.doc, to)).scrollIntoView();
  editor.view.dispatch(tr);
}

/** Leaves `text` in place of the live words as one undo step, or removes them. */
export function endDictation(editor: Editor, text: string | null) {
  const { state } = editor;
  const live = key.getState(state);
  if (!live) return;
  const following = state.selection.empty && state.selection.from === live.to;
  const removed = state.tr.delete(live.from, live.to + live.trail);
  removed.setMeta(key, null).setMeta("addToHistory", false);
  editor.view.dispatch(removed);
  if (!text) return;
  const after = editor.state;
  text = fitCase(text, lineBefore(after, live.from));
  const { lead, trail } = padding(after, live.from, live.from);
  const tr = closeHistory(after.tr.insertText(lead + text + trail, live.from));
  const end = live.from + lead.length + text.length;
  if (following)
    tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.dispatch(closeHistory(editor.state.tr));
}
