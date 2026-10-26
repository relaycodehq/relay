import { StateEffect, StateField, type Range, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { LspInlayHint } from "../../../shared/language-servers";
import { lsp, onLspDiagnostics } from "../language-servers/client";
import { tellServerText } from "./lsp-sync";
import { offsetAt } from "./positions";

/** Lines asked for above and below the screen, so a short scroll finds its hints there already. */
const MARGIN_LINES = 100;
/** A longer hint is cut short, as PhpStorm cuts a long inferred type; the whole of it shows on hover. */
const LONGEST = 44;

class HintWidget extends WidgetType {
  constructor(readonly hint: LspInlayHint) {
    super();
  }

  eq(other: HintWidget) {
    const [a, b] = [this.hint, other.hint];
    return a.label === b.label && a.kind === b.kind && a.paddingLeft === b.paddingLeft && a.paddingRight === b.paddingRight;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-inlay";
    span.classList.toggle("cm-inlay-left", this.hint.paddingLeft);
    span.classList.toggle("cm-inlay-right", this.hint.paddingRight);
    const { label } = this.hint;
    span.textContent = label.length > LONGEST ? `${label.slice(0, LONGEST - 1)}…` : label;
    if (label.length > LONGEST) span.title = label;
    return span;
  }
}

function decorationsOf(doc: Text, hints: readonly LspInlayHint[]) {
  const ranges: Range<Decoration>[] = hints.map((hint) => {
    // A parameter's name sits before its argument, a type after its name: the caret stays on the code's side.
    const side = hint.kind === "parameter" ? -1 : 1;
    const widget = Decoration.widget({ widget: new HintWidget(hint), side });
    return widget.range(offsetAt(doc, hint.line, hint.character));
  });
  return Decoration.set(ranges, true);
}

const setHints = StateEffect.define<DecorationSet>();

const hintsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(hints, tr) {
    let next = hints.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setHints)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Asks the server for the hints around the screen once typing or scrolling
 * pauses. A server still loading the project answers with none, so an empty
 * answer is asked again when the file's diagnostics come: by then it has read it.
 */
const hintsAsker = (where: string, path: string) =>
  ViewPlugin.fromClass(
    class {
      private timer = 0;
      private asked = 0;
      private answeredNone = false;
      private readonly stopHearing: () => void;

      constructor(private readonly view: EditorView) {
        this.later();
        this.stopHearing = onLspDiagnostics(where, path, () => {
          if (this.answeredNone) this.later();
        });
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.later();
      }

      destroy() {
        window.clearTimeout(this.timer);
        this.stopHearing();
        this.asked = -1;
      }

      private later() {
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => void this.ask(), 400);
      }

      private async ask() {
        const { view } = this;
        const ask = ++this.asked;
        const { doc } = view.state;
        const first = Math.max(doc.lineAt(view.viewport.from).number - 1 - MARGIN_LINES, 0);
        const last = Math.min(doc.lineAt(view.viewport.to).number + MARGIN_LINES, doc.lines);
        await tellServerText(where, path, doc);
        const hints = await lsp.inlayHints(where, path, first, last).catch(() => []);
        // An answer for text that has changed since, or for an older question, is dropped.
        if (ask !== this.asked || view.state.doc !== doc) return;
        this.answeredNone = !hints.length;
        view.dispatch({ effects: setHints.of(decorationsOf(doc, hints)) });
      }
    },
  );

const hintsTheme = EditorView.theme({
  ".cm-inlay": {
    display: "inline-block",
    padding: "0 4px",
    borderRadius: "4px",
    backgroundColor: "color-mix(in srgb, var(--code-foreground) 7%, transparent)",
    color: "color-mix(in srgb, var(--code-foreground) 48%, transparent)",
    fontFamily: "var(--font-sans)",
    fontSize: "0.88em",
    lineHeight: "1.45",
    fontStyle: "normal",
    fontWeight: "normal",
    cursor: "default",
  },
  ".cm-inlay-left": { marginLeft: "4px" },
  ".cm-inlay-right": { marginRight: "4px" },
});

/** PhpStorm's inlay hints from the language server: inferred types, and the names of literal arguments. */
export const inlayHints = (where: string, path: string) => [hintsField, hintsAsker(where, path), hintsTheme];
