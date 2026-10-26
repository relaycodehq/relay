import {
  deleteLine,
  insertBlankLine,
  moveLineDown,
  moveLineUp,
  toggleBlockComment,
  toggleLineComment,
} from "@codemirror/commands";
import { foldAll, foldCode, unfoldAll, unfoldCode } from "@codemirror/language";
import {
  findNext,
  findPrevious,
  gotoLine,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { startCompletion } from "@codemirror/autocomplete";
import { nextDiagnostic, previousDiagnostic } from "@codemirror/lint";
import { EditorSelection, Facet, Prec } from "@codemirror/state";
import { EditorView, keymap, type Command, type KeyBinding } from "@codemirror/view";
import { matches } from "../../lib/shortcuts";
import { stepChange } from "./change-gutter";
import { openFind, openReplace } from "./find-bar/find-bar";
import {
  duplicate,
  joinLines,
  newLineAbove,
  toggleCase,
  unselectOccurrence,
} from "./edit-commands";
import { extendSelection, shrinkSelection } from "./expand-selection";

type Action = (view: EditorView, pos: number) => boolean;

/**
 * What the editor asks its host to do, with the caret's position: the
 * symbol there, Back and Forward through the places jumps left from, and
 * the project-wide searches.
 */
export type SymbolActions = {
  definition?: Action;
  references?: Action;
  rename?: Action;
  format?: Action;
  fileStructure?: Action;
  back?: Action;
  forward?: Action;
  /** Past the file's last (or first) change: on to the next changed file. */
  nextChangedFile?: Action;
  previousChangedFile?: Action;
  searchEverywhere?: Action;
  goToFile?: Action;
  goToSymbol?: Action;
  recentFiles?: Action;
  findInFiles?: Action;
  replaceInFiles?: Action;
};

export const symbolActions = Facet.define<SymbolActions, SymbolActions>({
  combine: (values) => Object.assign({}, ...values),
});

/** Runs the host's action of that kind at the caret; false when the host has none. */
const atCaret =
  (kind: keyof SymbolActions): Command =>
  (view) =>
    view.state.facet(symbolActions)[kind]?.(view, view.state.selection.main.head) ??
    false;

/** Next and Previous Change, then on to the next changed file. */
const stepThrough =
  (forward: boolean): Command =>
  (view) =>
    stepChange(view, forward) ||
    atCaret(forward ? "nextChangedFile" : "previousChangedFile")(view);

/**
 * PhpStorm's keys, both its old "Mac OS X" keymap (⌘W to extend the
 * selection) and the newer macOS one (⌥↑) where they don't collide. Ahead of
 * CodeMirror's own, which bind several of these keys to other things.
 */
const phpstormKeys: KeyBinding[] = [
  { key: "Mod-w", run: extendSelection },
  { key: "Mod-Shift-w", run: shrinkSelection },
  { key: "Alt-ArrowUp", run: extendSelection },
  { key: "Alt-ArrowDown", run: shrinkSelection },
  { key: "Mod-d", run: duplicate },
  // ⌘⌫ on a Mac; Ctrl+Backspace deletes a word everywhere else, and PhpStorm's Ctrl+Y the line.
  { mac: "Mod-Backspace", win: "Mod-y", linux: "Mod-y", run: deleteLine },
  { key: "Alt-Shift-ArrowUp", run: moveLineUp },
  { key: "Alt-Shift-ArrowDown", run: moveLineDown },
  { key: "Mod-Shift-ArrowUp", run: moveLineUp },
  { key: "Mod-Shift-ArrowDown", run: moveLineDown },
  { key: "Mod-/", run: toggleLineComment },
  { key: "Mod-Alt-/", run: toggleBlockComment },
  // Ctrl is Mod off a Mac, so there PhpStorm puts occurrences on Alt+J and Go to Line on Ctrl+G.
  { mac: "Ctrl-g", win: "Alt-j", linux: "Alt-j", run: selectNextOccurrence, preventDefault: true },
  { mac: "Ctrl-Shift-g", win: "Alt-Shift-j", linux: "Alt-Shift-j", run: unselectOccurrence },
  { mac: "Ctrl-Mod-g", win: "Ctrl-Alt-Shift-j", linux: "Ctrl-Alt-Shift-j", run: selectSelectionMatches },
  { key: "Mod-l", run: gotoLine },
  { win: "Mod-g", linux: "Mod-g", run: gotoLine },
  { key: "Mod-f", run: openFind },
  { key: "Mod-r", run: openReplace },
  { mac: "Mod-g", run: findNext, shift: findPrevious },
  { key: "F3", run: findNext, shift: findPrevious },
  // PhpStorm's Next and Previous Highlighted Error.
  { key: "F2", run: nextDiagnostic, shift: previousDiagnostic },
  { key: "Shift-Enter", run: insertBlankLine },
  { key: "Mod-Alt-Enter", run: newLineAbove },
  { key: "Ctrl-Shift-j", run: joinLines },
  { key: "Mod-Shift-u", run: toggleCase },
  { key: "Mod-=", run: unfoldCode },
  { key: "Mod--", run: foldCode },
  { key: "Mod-Shift-=", run: unfoldAll },
  { key: "Mod-Shift--", run: foldAll },
  { key: "Ctrl-Space", run: startCompletion },
  { key: "Mod-b", run: atCaret("definition") },
  { key: "Shift-F6", run: atCaret("rename") },
  { key: "Ctrl-Alt-Shift-ArrowDown", run: stepThrough(true) },
  { key: "Ctrl-Alt-Shift-ArrowUp", run: stepThrough(false) },
  { key: "Mod-Alt-l", run: atCaret("format") },
  { key: "Mod-F12", run: atCaret("fileStructure") },
  { key: "Mod-Shift-o", run: atCaret("goToFile") },
  { key: "Mod-o", run: atCaret("goToSymbol") },
  { key: "Mod-Alt-o", run: atCaret("goToSymbol") },
  { key: "Mod-e", run: atCaret("recentFiles") },
  { key: "Mod-Shift-f", run: atCaret("findInFiles") },
  { key: "Mod-Shift-r", run: atCaret("replaceInFiles") },
  { key: "Mod-[", run: atCaret("back") },
  { key: "Mod-]", run: atCaret("forward") },
  { key: "Mod-Alt-ArrowLeft", run: atCaret("back") },
  { key: "Mod-Alt-ArrowRight", run: atCaret("forward") },
];

/** Go to Definition and Find Usages on the keys set in Settings → Shortcuts. */
const settingsKeys = EditorView.domEventHandlers({
  keydown(event, view) {
    const kind = (["definition", "references"] as const).find((id) =>
      matches(id, event),
    );
    if (!kind || !atCaret(kind)(view)) return false;
    event.preventDefault();
    return true;
  },
});

export const phpstormKeymap = [Prec.high(keymap.of(phpstormKeys)), settingsKeys];

/** ⌘-click goes to the definition; ⌥⇧-click adds a caret, as in PhpStorm. */
export const phpstormMouse = [
  EditorView.clickAddsSelectionRange.of((event) => event.altKey && event.shiftKey),
  EditorView.domEventHandlers({
    // A mouse's side buttons step Back and Forward.
    mouseup(event, view) {
      if (event.button !== 3 && event.button !== 4) return false;
      return atCaret(event.button === 3 ? "back" : "forward")(view);
    },
    mousedown(event, view) {
      const commandClick =
        event.button === 0 &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey;
      if (!commandClick) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const go = view.state.facet(symbolActions).definition;
      if (pos == null || !go) return false;
      event.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(pos) });
      return go(view, pos);
    },
  }),
];
