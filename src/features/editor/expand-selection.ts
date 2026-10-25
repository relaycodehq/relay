import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type SelectionRange,
  type StateCommand,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

const OPEN = new Set(["(", "[", "{", "<", '"', "'", "`", '"""', "'''"]);

type Span = { from: number; to: number };

/** Longest string token whose quotes are looked for; longer ones are skipped to stay fast. */
const MAX_QUOTED_LENGTH = 100_000;

/** For a string the grammar keeps as one token, the span inside its quotes. */
function insideQuotes(state: EditorState, node: SyntaxNode): Span | undefined {
  if (node.firstChild || node.to - node.from > MAX_QUOTED_LENGTH) return undefined;
  const quoted = /^(\w*)(["'`]+)[\s\S]*?\2$/.exec(state.sliceDoc(node.from, node.to));
  if (!quoted) return undefined;
  const open = quoted[1].length + quoted[2].length;
  if (node.to - node.from < open * 2) return undefined;
  return { from: node.from + open, to: node.to - quoted[2].length };
}

/**
 * For a node that starts and ends with brackets or quotes, the span inside
 * them, then the same span without the blank space around its contents.
 */
function insideBrackets(state: EditorState, node: SyntaxNode): Span[] {
  const first = node.firstChild;
  const last = node.lastChild;
  if (!first || !last || first === last) return [];
  const open = state.sliceDoc(first.from, first.to);
  if (!OPEN.has(open) && !/^\w*["'`]+$/.test(open)) return [];
  const spans = [{ from: first.to, to: last.from }];
  const inner = state.sliceDoc(first.to, last.from);
  const lead = inner.length - inner.trimStart().length;
  const trail = inner.length - inner.trimEnd().length;
  if (lead + trail < inner.length)
    spans.push({ from: first.to + lead, to: last.from - trail });
  return spans;
}

/** Spans a selection may grow to around `from`–`to`, from the syntax tree outwards. */
function candidates(state: EditorState, from: number, to: number) {
  const ranges: Span[] = [];
  const add = (a: number, b: number) => {
    if (a <= from && b >= to && b - a > to - from) ranges.push({ from: a, to: b });
  };
  if (from === to) {
    const word = state.wordAt(from);
    if (word) add(word.from, word.to);
  }
  const tree = syntaxTree(state);
  const climb = (start: SyntaxNode | null) => {
    for (let node = start; node; node = node.parent) {
      add(node.from, node.to);
      // Like PhpStorm, inside the quotes or brackets comes before the whole node.
      const quotes = insideQuotes(state, node);
      if (quotes) add(quotes.from, quotes.to);
      for (const span of insideBrackets(state, node)) add(span.from, span.to);
    }
  };
  climb(tree.resolveInner(from, 1));
  climb(tree.resolveInner(to, -1));
  // Plain text has no syntax to go by, so whole lines are the next step.
  if (!ranges.some((r) => r.to - r.from < state.doc.length)) {
    const start = state.doc.lineAt(from);
    const end = state.doc.lineAt(to);
    add(start.from, end.to);
  }
  add(0, state.doc.length);
  return ranges;
}

/** The smallest step out from `range`, or the range itself at the top. */
export function expandRange(state: EditorState, range: SelectionRange) {
  let best: Span | undefined;
  for (const candidate of candidates(state, range.from, range.to))
    if (!best || candidate.to - candidate.from < best.to - best.from)
      best = candidate;
  return best ? EditorSelection.range(best.from, best.to) : range;
}

const push = StateEffect.define<EditorSelection>();
const pop = StateEffect.define<null>();

/** The selections ⌘W grew from, so ⌘⇧W can go back through them. Any other selection change or edit clears the list. */
export const selectionSteps = StateField.define<readonly EditorSelection[]>({
  create: () => [],
  update(value, tr) {
    let stepped = false;
    for (const effect of tr.effects) {
      if (effect.is(push)) value = [...value, effect.value];
      else if (effect.is(pop)) value = value.slice(0, -1);
      else continue;
      stepped = true;
    }
    if (stepped) return value;
    return tr.docChanged || tr.selection ? [] : value;
  },
});

/** PhpStorm's Extend Selection: each press takes in the next syntax node out. */
export const extendSelection: StateCommand = ({ state, dispatch }) => {
  const next = EditorSelection.create(
    state.selection.ranges.map((range) => expandRange(state, range)),
    state.selection.mainIndex,
  );
  if (next.eq(state.selection)) return false;
  dispatch(
    state.update({
      selection: next,
      effects: push.of(state.selection),
      scrollIntoView: true,
      userEvent: "select",
    }),
  );
  return true;
};

/** Shrink Selection: back the way Extend Selection came. */
export const shrinkSelection: StateCommand = ({ state, dispatch }) => {
  const previous = state.field(selectionSteps, false)?.at(-1);
  if (!previous) return false;
  dispatch(
    state.update({
      selection: previous,
      effects: pop.of(null),
      scrollIntoView: true,
      userEvent: "select",
    }),
  );
  return true;
};
