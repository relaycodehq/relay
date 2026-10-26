import { getChunks, getOriginalDoc, unifiedMergeView, type Chunk } from "@codemirror/merge";
import { highlightingFor, language } from "@codemirror/language";
import {
  RangeSetBuilder,
  StateField,
  type EditorState,
  type Extension,
  type Text,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";
import { addedLines, changedWhole } from "./added-lines";
import { lineFirstDiff } from "./line-first-diff";

/** Longer deletions show without syntax colours, as the merge view does. */
const MAX_HIGHLIGHTED = 3000;

/** Where in a deletion's text the words that changed are. */
type Span = readonly [from: number, to: number];

/**
 * The lines a change removed, drawn above where they were. Two are the same
 * when their text and changed words are: the merge view diffs the lines
 * around every edit again, and the chunks it makes for unchanged deletions
 * mustn't redraw every line between them.
 */
class DeletedLines extends WidgetType {
  constructor(
    readonly text: string,
    readonly changed: readonly Span[],
  ) {
    super();
  }

  eq(other: DeletedLines) {
    return (
      other.text === this.text &&
      other.changed.length === this.changed.length &&
      other.changed.every(([from, to], i) => from === this.changed[i][0] && to === this.changed[i][1])
    );
  }

  toDOM(view: EditorView) {
    return deletedLinesDOM(view.state, this.text, this.changed);
  }
}

/** The merge view's own markup for removed lines, so its styles still apply. */
function deletedLinesDOM(state: EditorState, text: string, changed: readonly Span[]) {
  const dom = document.createElement("div");
  dom.className = "cm-deletedChunk";
  const syntax = syntaxClasses(state, text);
  const changedAt = (at: number) => changed.some(([from, to]) => at >= from && at < to);
  for (const [lineFrom, lineTo] of lineSpans(text)) {
    const del = dom.appendChild(document.createElement("div"));
    del.className = "cm-deletedLine";
    const line = del.appendChild(document.createElement("del"));
    let runFrom = lineFrom;
    // A line removed whole is struck out by its tint alone, as a line added whole is.
    const removedWhole = changedWhole(text.slice(lineFrom, lineTo), (at) =>
      changedAt(lineFrom + at),
    );
    const struck = (at: number) => changedAt(at) && !removedWhole;
    const classAt = (at: number) =>
      [syntax[at], struck(at) ? "cm-deletedText" : ""].filter(Boolean).join(" ");
    for (let at = lineFrom + 1; at <= lineTo; at++) {
      if (at < lineTo && classAt(at) === classAt(runFrom)) continue;
      appendRun(line, text.slice(runFrom, at), classAt(runFrom));
      runFrom = at;
    }
    if (!line.firstChild) line.appendChild(document.createElement("br"));
  }
  return dom;
}

function appendRun(line: HTMLElement, text: string, className: string) {
  if (!className) return void line.appendChild(document.createTextNode(text));
  const span = line.appendChild(document.createElement("span"));
  span.className = className;
  span.textContent = text;
}

/** Each line's start and end in `text`, without the line breaks. */
function lineSpans(text: string): Span[] {
  const spans: Span[] = [];
  let from = 0;
  for (let end = text.indexOf("\n"); end >= 0; end = text.indexOf("\n", from)) {
    spans.push([from, end]);
    from = end + 1;
  }
  spans.push([from, text.length]);
  return spans;
}

/** The editor's highlight class of every character of `text`, read in the editor's language. */
function syntaxClasses(state: EditorState, text: string) {
  const classes: string[] = [];
  const parser = state.facet(language);
  if (!parser || text.length > MAX_HIGHLIGHTED) return classes;
  highlightTree(
    parser.parser.parse(text),
    { style: (tags) => highlightingFor(state, tags) },
    (from, to, className) => classes.fill(className, from, to),
  );
  return classes;
}

/** The removed lines of one chunk, with what changed in them relative to their start. */
function deletedLinesOf(chunk: Chunk, original: Text) {
  const text = original.sliceString(chunk.fromA, chunk.endA);
  // Clipped to the text: a diff may anchor the same removal at the line break
  // before it or after it, and both must read as the same lines.
  const changed = chunk.changes
    .map((change): Span => [Math.max(0, change.fromA), Math.min(text.length, change.toA)])
    .filter(([from, to]) => from < to);
  return new DeletedLines(text, changed);
}

/** Chunks keep their changes when only moved, so their widget can be kept with them. */
const made = new WeakMap<Chunk["changes"], Decoration>();

function deletions(state: EditorState): DecorationSet {
  const chunks = getChunks(state)?.chunks ?? [];
  const original = getOriginalDoc(state);
  const builder = new RangeSetBuilder<Decoration>();
  for (const chunk of chunks) {
    if (chunk.fromA >= chunk.toA) continue; // nothing removed
    let deco = made.get(chunk.changes);
    if (!deco) {
      deco = Decoration.widget({ block: true, side: -1, widget: deletedLinesOf(chunk, original) });
      made.set(chunk.changes, deco);
    }
    builder.add(chunk.fromB, chunk.fromB, deco);
  }
  return builder.finish();
}

const deletedLines = StateField.define<DecorationSet>({
  create: deletions,
  update(deco, tr) {
    const chunksMoved = getChunks(tr.state)?.chunks !== getChunks(tr.startState)?.chunks;
    return chunksMoved ? deletions(tr.state) : deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * What changed since `original`, inline: changed lines tinted, removed ones
 * shown above where they were. The merge view's own removed lines are left
 * out (its only state field), because it redraws every line near an edit,
 * and so is its diff, which calls a long file edited in many places rewritten.
 */
export function inlineDiff(original: string): Extension {
  const mergeView = unifiedMergeView({
    original,
    mergeControls: false,
    gutter: false,
    diffConfig: { override: lineFirstDiff },
  }) as Extension[];
  return [
    mergeView.filter((part) => !(part instanceof StateField)),
    deletedLines,
    addedLines,
  ];
}
