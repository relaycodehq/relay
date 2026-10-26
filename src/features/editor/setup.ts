import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
} from "@codemirror/view";
import { clipUnderGutter } from "./clip-under-gutter";
import { findBar } from "./find-bar/find-bar";
import { editorChrome } from "./editor-theme";
import { extraHighlights } from "./extra-highlights";
import { foldImports } from "./view-aids/fold-imports";
import { minimap } from "./minimap/minimap";
import { guides } from "./view-aids/guides";
import { stickyScopes } from "./view-aids/sticky-scopes";
import { selectionSteps } from "./expand-selection";
import { outsideTooltips } from "./outside-tooltips";
import { phpstormKeymap, phpstormMouse } from "./keymap";

/** The narrowest indent the file already uses, a tab when any line starts with one. */
export function detectIndent(text: string) {
  let width = 4;
  let seen = false;
  const sample = text.length > 200_000 ? text.slice(0, 200_000) : text;
  for (const line of sample.split("\n")) {
    if (line.startsWith("\t")) return "\t";
    // A block comment's " * " lines are aligned to its opening, not indented.
    const spaces = /^( +)(?!\*)\S/.exec(line)?.[1].length;
    if (spaces && spaces < width) width = spaces;
    if (spaces) seen = true;
  }
  return " ".repeat(seen ? Math.max(width, 2) : 2);
}

/**
 * The parts of the editor that depend on where it is shown. Every document's
 * state has all of them, so a document that moves to another view keeps its
 * place, and each view fills them in for itself.
 */
export const slots = {
  changes: new Compartment(),
  language: new Compartment(),
  theme: new Compartment(),
  actions: new Compartment(),
  readOnly: new Compartment(),
  host: new Compartment(),
};

/** CodeMirror's own dialog labels, in sentence case like the rest of the app. */
const phrases = EditorState.phrases.of({
  close: "Close",
  "Go to line": "Go to line",
  go: "Go",
});

/** The fold gutter's marker, told apart by class so a folded one can stay shown. */
function foldMarker(open: boolean) {
  const marker = document.createElement("span");
  marker.className = open ? "cm-fold-open" : "cm-fold-closed";
  marker.textContent = open ? "⌄" : "›";
  marker.title = open ? "Fold line" : "Unfold line";
  return marker;
}

/** Everything an editable code file gets, whatever its language. */
export function baseExtensions(text: string): Extension[] {
  const unit = detectIndent(text);
  return [
    lineNumbers(),
    slots.changes.of([]),
    foldGutter({ markerDOM: foldMarker }),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history({ minDepth: 500 }),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of(unit),
    EditorState.tabSize.of(unit === "\t" ? 4 : unit.length),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ activateOnTyping: true, closeOnBlur: true }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches({ minSelectionLength: 2 }),
    findBar,
    scrollPastEnd(),
    selectionSteps,
    phpstormKeymap,
    phpstormMouse,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    editorChrome,
    clipUnderGutter,
    extraHighlights,
    guides,
    stickyScopes,
    minimap,
    foldImports,
    outsideTooltips(),
    phrases,
    slots.language.of([]),
    slots.theme.of([]),
    slots.actions.of([]),
    slots.readOnly.of([]),
    slots.host.of([]),
  ];
}
