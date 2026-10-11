import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { Node, Slice } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { fitCase, fitEnd } from "../../../../shared/dictation";

/**
 * The words being dictated: `from`–`to` in the draft, tentative from
 * `tentative` on, followed by `trail` characters of added spacing.
 * `settled` is the engine's settled text as last shown; the start of it,
 * `handed`, already sits before `from` as the user's own text.
 * `replaced` is the selection the words took the place of, out of the draft
 * until they are done, so that discarding puts it back and undo is one step.
 */
interface Live {
  from: number;
  to: number;
  tentative: number;
  trail: number;
  settled: string;
  handed: string;
  replaced: { slice: Slice; at: number } | null;
}

/** Whether `tr` changes the settled words rather than only text around them. */
function editsSettled(tr: Transaction, live: Live) {
  let from = live.from,
    end = live.tentative,
    touched = false;
  for (const map of tr.mapping.maps) {
    map.forEach((start, stop) => {
      if (start < end && stop > from) touched = true;
    });
    from = map.map(from, 1);
    end = map.map(end, -1);
  }
  return touched;
}

/** The engine's settled text without what was handed over. */
const unhanded = (live: Live, settled: string) =>
  // Settled text only ever grows, so what was handed over is its start.
  settled.slice(live.handed.length).trimStart();

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
            // Editing a settled word makes the settled words the user's own;
            // dictation carries on after them.
            const handOver = editsSettled(tr, live);
            // Typing around the dictated words stays outside them.
            const from = handOver
                ? tr.mapping.map(live.tentative, -1)
                : tr.mapping.map(live.from, 1),
              to = Math.max(from, tr.mapping.map(live.to, -1));
            return {
              ...live,
              handed: handOver ? live.settled : live.handed,
              replaced: live.replaced && {
                ...live.replaced,
                at: tr.mapping.map(live.replaced.at, 1),
              },
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
            const working = live.tentative < live.to;
            // While words may still change, a spinner stands where they end.
            const decorations = [
              working
                ? Decoration.widget(live.to, spinner, {
                    side: 1,
                    key: "dictation-spinner",
                  })
                : Decoration.widget(live.to, caret, {
                    side: 1,
                    key: "dictation-caret",
                  }),
            ];
            if (working)
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

/** The app's steady spinner (src/ui Spinner), built by hand for a widget. */
function spinner() {
  const element = document.createElement("span");
  element.className = "spinner steady dictation-spinner";
  element.setAttribute("aria-hidden", "true");
  element.innerHTML =
    '<svg width="11" height="11" viewBox="0 0 16 16">' +
    '<circle class="spinner-track" cx="8" cy="8" r="6.25"/>' +
    '<circle class="spinner-arc" cx="8" cy="8" r="6.25" pathLength="100"/>' +
    "</svg>";
  return element;
}

/** The draft's text on the dictation's line before `from`. */
function lineBefore(doc: Node, from: number) {
  return doc.textBetween(doc.resolve(from).start(), from, "\n", " ");
}

/** The draft's text on the dictation's line after `to`. */
function lineAfter(doc: Node, to: number) {
  return doc.textBetween(to, doc.resolve(to).end(), "\n", " ");
}

/** Dictated `words` fitted to the sentence around `from`–`to`. */
const fit = (words: string, doc: Node, from: number, to: number) =>
  fitEnd(fitCase(words, lineBefore(doc, from)), lineAfter(doc, to));

/** Spaces that keep dictated words apart from the text around them. */
function padding(doc: Node, from: number, to: number) {
  const $from = doc.resolve(from),
    $to = doc.resolve(to);
  const before = $from.parentOffset
      ? doc.textBetween(from - 1, from, "\n", "￼")
      : "",
    after =
      $to.parentOffset < $to.parent.content.size
        ? doc.textBetween(to, to + 1, "\n", "￼")
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
    closeHistory(tr)
      .setMeta(key, {
        from,
        to: from,
        tentative: from,
        trail: 0,
        settled: "",
        handed: "",
        replaced:
          from < to ? { slice: state.doc.slice(from, to), at: from } : null,
      })
      .setMeta("addToHistory", false),
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
  const end = live.to + live.trail;
  const heard = [unhanded(live, settled), tentative].filter(Boolean).join(" ");
  const words = fit(heard, state.doc, live.from, end);
  // Any ending fit dropped came off the tentative words first.
  const tentativeLength = Math.max(
    0,
    tentative.length - (heard.length - words.length),
  );
  const { lead, trail } = padding(state.doc, live.from, end);
  const text = words ? lead + words + trail : "";
  const following = state.selection.empty && state.selection.from === live.to;
  // Only what changed is replaced, so a selection in the words before it stays.
  const shown = state.doc.textBetween(live.from, end, "\n", "￼");
  let same = 0;
  if (shown.length === end - live.from)
    while (same < shown.length && shown[same] === text[same]) same++;
  const tr = state.tr;
  if (same < text.length)
    tr.replaceWith(live.from + same, end, state.schema.text(text.slice(same)));
  else if (live.from + same < end) tr.delete(live.from + same, end);
  const to = live.from + text.length - trail.length;
  tr.setMeta(key, {
    ...live,
    to,
    tentative: to - tentativeLength,
    trail: text ? trail.length : 0,
    settled,
  }).setMeta("addToHistory", false);
  if (following)
    tr.setSelection(TextSelection.create(tr.doc, to)).scrollIntoView();
  editor.view.dispatch(tr);
}

/**
 * Leaves `text` in place of the live words, and of the selection they took
 * the place of, as one undo step; without it, puts the draft back.
 */
export function endDictation(editor: Editor, text: string | null) {
  const { state } = editor;
  const live = key.getState(state);
  if (!live) return;
  const following = state.selection.empty && state.selection.from === live.to;
  const { replaced } = live;
  const restored = state.tr.delete(live.from, live.to + live.trail);
  let at = live.from;
  if (replaced) {
    at = restored.mapping.map(replaced.at, 1);
    restored.replace(at, at, replaced.slice);
  }
  // Words handed over stay where they are; the rest go after them.
  let from = live.handed ? restored.mapping.map(live.from, 1) : at;
  restored.setMeta(key, null).setMeta("addToHistory", false);
  editor.view.dispatch(restored);
  const words = text ? unhanded(live, text) : "";
  // Once handed over, the selection was replaced either way.
  const drop = replaced && (words || live.handed) ? replaced.slice.size : 0;
  if (!words && !drop) return;
  const tr = closeHistory(editor.state.tr);
  if (drop) {
    tr.delete(at, at + drop);
    from = tr.mapping.map(from);
  }
  if (words) {
    const fitted = fit(words, tr.doc, from, from);
    const { lead, trail } = padding(tr.doc, from, from);
    tr.insertText(lead + fitted + trail, from);
    const end = from + lead.length + fitted.length;
    if (following)
      tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView();
  }
  editor.view.dispatch(tr);
  editor.view.dispatch(closeHistory(editor.state.tr));
}
