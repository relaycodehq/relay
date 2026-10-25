import {
  ChangeSet,
  EditorSelection,
  RangeSet,
  type Range,
  StateEffect,
  StateField,
  type ChangeDesc,
  type Text,
} from "@codemirror/state";
import {
  EditorView,
  gutter,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { committedLine, type LineHunk } from "./line-changes";
import LineChangesWorker from "./line-changes.worker?worker";

class ChangeMark extends GutterMarker {
  constructor(readonly elementClass: string) {
    super();
  }
  eq(other: GutterMarker) {
    return other instanceof ChangeMark && other.elementClass === this.elementClass;
  }
}

const marks = {
  added: new ChangeMark("cm-change-added"),
  modified: new ChangeMark("cm-change-modified"),
  /** Lines were removed just above this one. */
  below: new ChangeMark("cm-change-removed-above-line"),
  /** Lines were removed just below this one, as at the end of the file. */
  above: new ChangeMark("cm-change-removed-below-line"),
};

/** Each changed line's mark, from hunks counted in 1-based lines of `doc`. */
export function changeMarks(doc: Text, hunks: readonly LineHunk[]) {
  const ranges: Range<GutterMarker>[] = [];
  const at = (line: number, mark: ChangeMark) => {
    if (line >= 1 && line <= doc.lines)
      ranges.push(mark.range(doc.line(line).from));
  };
  for (const { line, added, removed } of hunks) {
    if (!added) {
      // Mark both lines around the gap, because lines removed from the end of
      // the file have no line below them.
      at(line - 1, marks.above);
      at(line, marks.below);
      continue;
    }
    for (let i = 0; i < added; i++)
      at(line + i, removed ? marks.modified : marks.added);
  }
  return RangeSet.of<GutterMarker>(ranges, true);
}

type Changes = {
  marks: RangeSet<GutterMarker>;
  /** The hunks, while the text is still the one they were worked out for. */
  hunks: readonly LineHunk[] | undefined;
};

const setChanges = StateEffect.define<Changes>();

const changes = StateField.define<Changes>({
  create: () => ({ marks: RangeSet.empty, hunks: [] }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setChanges)) return effect.value;
    // Until the worker answers, move the marks along with the edits.
    return tr.docChanged
      ? { marks: value.marks.map(tr.changes), hunks: undefined }
      : value;
  },
});

/**
 * The committed line number of a line in the editor. Undefined means the line
 * was added or changed since the commit, and null means the worker hasn't
 * caught up with the latest edit yet, so it can't be told.
 */
export function committedLineAt(view: EditorView, line: number) {
  const { hunks } = view.state.field(changes, false) ?? {};
  if (!hunks) return null;
  return committedLine(hunks, line);
}

/**
 * Works the buffer's edits against `committed` out on a worker, one question
 * in flight and the latest text asked next. An answer for older text is
 * mapped through the edits made since, so the bars never jump back.
 */
const hunksOnWorker = (committed: string) =>
  ViewPlugin.fromClass(
    class {
      worker: Worker | undefined;
      /** What's in flight: the text asked about and the edits made since. */
      asked: { doc: Text; since: ChangeDesc } | undefined;
      waiting = false;
      sentCommitted = false;
      constructor(readonly view: EditorView) {
        this.ask();
      }
      ask() {
        const { view } = this;
        if (!this.worker) {
          this.worker = new LineChangesWorker();
          this.worker.onmessage = (event: MessageEvent<LineHunk[]>) =>
            this.answer(event.data);
          this.worker.onerror = (event) => {
            console.error("Line changes failed", event.message);
            this.asked = undefined;
          };
        }
        const doc = view.state.doc;
        this.asked = { doc, since: ChangeSet.empty(doc.length) };
        this.waiting = false;
        this.worker.postMessage(
          this.sentCommitted
            ? { buffer: view.state.sliceDoc() }
            : { committed, buffer: view.state.sliceDoc() },
        );
        this.sentCommitted = true;
      }
      answer(hunks: LineHunk[]) {
        const asked = this.asked;
        this.asked = undefined;
        if (!asked) return;
        const current = asked.since.empty;
        const marks = changeMarks(asked.doc, hunks);
        // This runs from the worker's message, outside any editor update,
        // where dispatching is allowed.
        this.view.dispatch({
          effects: setChanges.of({
            marks: current ? marks : marks.map(asked.since),
            hunks: current ? hunks : undefined,
          }),
        });
        if (this.waiting) this.ask();
      }
      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (this.asked) {
          this.asked.since = this.asked.since.composeDesc(update.changes.desc);
          this.waiting = true;
        } else this.ask();
      }
      destroy() {
        this.worker?.terminate();
      }
    },
  );

const gutterExtension = gutter({
  class: "cm-change-gutter",
  markers: (view) => view.state.field(changes).marks,
});

/**
 * IDE change bars against `committed` in their own narrow gutter: green for
 * added lines, blue for changed ones, a red notch where lines were removed.
 * No committed text (a folder without Git) keeps the gutter, empty, so the
 * code doesn't shift when it arrives.
 */
export function changeGutter(committed: string | undefined) {
  return committed === undefined
    ? [changes, gutterExtension]
    : [changes, gutterExtension, hunksOnWorker(committed)];
}

/** The offset where each run of changed lines starts, in order. */
function changeStarts(view: EditorView) {
  const marks = view.state.field(changes, false)?.marks;
  const starts: number[] = [];
  if (!marks) return starts;
  let lastLine = -2;
  for (let cursor = marks.iter(); cursor.value; cursor.next()) {
    const line = view.state.doc.lineAt(cursor.from).number;
    if (line > lastLine + 1) starts.push(cursor.from);
    lastLine = line;
  }
  return starts;
}

/**
 * The caret to the next (or previous) run of changed lines. False past the
 * last one, so the host can carry on in the next changed file.
 */
export function stepChange(view: EditorView, forward: boolean) {
  const starts = changeStarts(view);
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const to = forward
    ? starts.find((pos) => pos > line.to)
    : [...starts].reverse().find((pos) => pos < line.from);
  if (to === undefined) return false;
  view.dispatch({
    selection: EditorSelection.cursor(to),
    effects: EditorView.scrollIntoView(to, { y: "center" }),
    userEvent: "select",
  });
  return true;
}
