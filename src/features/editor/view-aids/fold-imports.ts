import { ensureSyntaxTree, foldEffect, foldService, foldedRanges, syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Text } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

/** Import statements across languages: JavaScript's, PHP's and Rust's `use`, Python's, Go's. */
const IMPORT = /^(ImportDeclaration|ImportStatement|ImportFromStatement|NamespaceUseDeclaration|UseDeclaration|ImportDecl)$/;

/** What may come before the imports: comments, PHP's opening tag and namespace, Go's and Java's package. */
const LEAD = /Comment|PhpOpen|Text|^NamespaceDefinition$|^PackageClause$|^PackageDeclaration$/;

/** Far enough down for any file's imports, without parsing the whole of a long file. */
const IMPORTS_WITHIN = 20_000;

/**
 * The run of imports at the top of the file, folded to "import …" as PhpStorm
 * shows it: from after the first keyword to the end of the last import.
 * Null when there is no run worth folding.
 */
export function importsRange(state: EditorState) {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, IMPORTS_WITHIN), 50);
  if (!tree) return null;
  // The fold gutter asks for every line it draws.
  const known = foundRanges.get(state.doc);
  if (known?.tree === tree) return known.range;
  const range = rangeIn(state, tree);
  foundRanges.set(state.doc, { tree, range });
  return range;
}

type ImportsRange = { from: number; to: number } | null;
const foundRanges = new WeakMap<Text, { tree: Tree; range: ImportsRange }>();

function rangeIn(state: EditorState, tree: Tree): ImportsRange {
  let first: { from: number; to: number } | undefined;
  let last: { from: number; to: number } | undefined;
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (IMPORT.test(node.name)) {
      first ??= node;
      last = node;
      continue;
    }
    // Comments, a file's opening tag and its namespace or package may come before the imports; anything else ends them.
    if (first || !LEAD.test(node.name)) break;
  }
  if (!first || !last) return null;
  const firstLine = state.doc.lineAt(first.from);
  if (state.doc.lineAt(last.to).number === firstLine.number) return null;
  const keyword = /^\s*\S+/.exec(state.sliceDoc(first.from, firstLine.to))![0].length;
  return { from: first.from + keyword, to: last.to };
}

/** Offers the imports' fold on their first line, so the fold gutter shows it there. */
const importsFold = foldService.of((state, lineStart, lineEnd) => {
  if (lineStart > IMPORTS_WITHIN) return null;
  const range = importsRange(state);
  return range && range.from >= lineStart && range.from <= lineEnd ? range : null;
});

/** Whether this document has had its imports folded once, so unfolding them sticks. */
const foldedOnce = StateField.define<boolean>({
  create: () => false,
  update: (folded, tr) => folded || tr.effects.some((effect) => effect.is(foldEffect)),
});

/**
 * Folds the imports the first time a file is shown, unless the caret is in
 * them. The file's language loads after it opens, so this waits for a parse.
 */
const foldOnOpen = ViewPlugin.fromClass(
  class {
    /** The imports were looked at once the file was parsed. */
    private looked = false;
    private timer = 0;

    constructor(private readonly view: EditorView) {
      this.later();
    }

    update(update: ViewUpdate) {
      const parsedMore = syntaxTree(update.state) !== syntaxTree(update.startState);
      if (!this.looked && parsedMore) this.later();
    }

    destroy() {
      window.clearTimeout(this.timer);
    }

    // A view can't be changed while it updates, so the fold waits a moment.
    private later() {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.fold(), 0);
    }

    private fold() {
      const { state } = this.view;
      if (this.looked || state.field(foldedOnce, false)) return;
      if (!syntaxTree(state).length) return; // no language yet
      this.looked = true;
      const range = importsRange(state);
      if (!range) return;
      const caret = state.selection.main.head;
      const caretInside = caret > range.from && caret <= range.to;
      let alreadyFolded = false;
      foldedRanges(state).between(range.from, range.to, () => void (alreadyFolded = true));
      if (caretInside || alreadyFolded) return;
      this.view.dispatch({ effects: foldEffect.of(range) });
    }
  },
);

/** PhpStorm folds a file's imports when it opens. */
export const foldImports = [importsFold, foldedOnce, foldOnOpen];
