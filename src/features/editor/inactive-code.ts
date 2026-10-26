import { RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import type { LspLineSpan } from "../../../shared/language-servers";
import { onLspInactiveLines } from "../language-servers/client";

const setInactive = StateEffect.define<readonly LspLineSpan[]>();
const inactiveLine = Decoration.line({ class: "cm-inactiveLine" });

function decorationsOf(doc: Text, spans: readonly LspLineSpan[]) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const span of [...spans].sort((a, b) => a.from - b.from))
    for (let n = span.from + 1; n <= Math.min(span.to + 1, doc.lines); n++)
      builder.add(doc.line(n).from, doc.line(n).from, inactiveLine);
  return builder.finish();
}

const inactiveField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lines, tr) {
    for (const effect of tr.effects) if (effect.is(setInactive)) return decorationsOf(tr.state.doc, effect.value);
    return lines.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const inactiveListener = (where: string, path: string) =>
  ViewPlugin.define((view) => ({
    destroy: onLspInactiveLines(where, path, (lines) => view.dispatch({ effects: setInactive.of(lines) })),
  }));

/** Every colour gives way to one grey, as CLion shows code the preprocessor leaves out. */
const inactiveTheme = EditorView.baseTheme({
  ".cm-inactiveLine, .cm-inactiveLine *": {
    color: "color-mix(in srgb, var(--code-foreground) 38%, transparent) !important",
  },
});

/**
 * Greys the code the compiler leaves out of the file, like another
 * platform's `#ifdef`, which clangd reports: it checks none of it, so an
 * error there gets no squiggle.
 */
export const inactiveCode = (where: string, path: string) => [inactiveField, inactiveListener(where, path), inactiveTheme];
