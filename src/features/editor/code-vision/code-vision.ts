import {
  Facet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Text,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from "@codemirror/view";
import { NEW_CODE, usagesLabel } from "./vision-lines";

/**
 * A hint over a declaration: where its name is, its usages once counted, and
 * who wrote it. `fresh` says the count is for the text as it now reads;
 * `failed` that counting failed, so it waits for the next hints to try again.
 */
export type VisionHint = { namePos: number; usages?: number; fresh?: boolean; failed?: boolean; author?: string };

export type VisionHost = {
  countUsages: (view: EditorView, namePos: number) => Promise<number>;
  showUsages: (view: EditorView, namePos: number) => void;
};

const visionHost = Facet.define<VisionHost, VisionHost | undefined>({
  combine: (values) => values[0],
});

/** The hints for the text as it now reads. */
export const setHints = StateEffect.define<VisionHint[]>();
const counted = StateEffect.define<{ namePos: number; usages: number | undefined }>();

/**
 * New hints keep what's known of the same name: its count, shown until it's
 * counted again so it doesn't flicker, and whether that count is still for
 * this text.
 */
function carryCounts(next: VisionHint[], before: VisionHint[]) {
  const known = new Map(before.map((hint) => [hint.namePos, hint]));
  return next.map((hint) => {
    const { usages, fresh } = known.get(hint.namePos) ?? {};
    return { ...hint, usages, fresh };
  });
}

/** The lines an edit touched, as they read before it and after. */
function touchedText(tr: Transaction) {
  const parts: string[] = [];
  const lines = (doc: Text, from: number, to: number) => doc.sliceString(doc.lineAt(from).from, doc.lineAt(to).to);
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    parts.push(lines(tr.startState.doc, fromA, toA), lines(tr.state.doc, fromB, toB));
  });
  return parts.join("\n");
}

/**
 * An edit in this file changes a count only where it adds or takes away a
 * use of the name, so only a name on the lines it touched is counted again.
 */
function staleAfter(hints: VisionHint[], tr: Transaction) {
  const touched = touchedText(tr);
  return hints.map((hint) => {
    const namePos = tr.changes.mapPos(hint.namePos);
    const name = /^[\w$]+/.exec(tr.state.doc.sliceString(namePos, namePos + 200))?.[0];
    const fresh = hint.fresh && !!name && !touched.includes(name);
    return { ...hint, namePos, fresh };
  });
}

const hintsField = StateField.define<VisionHint[]>({
  create: () => [],
  update(hints, tr) {
    let next = tr.docChanged ? staleAfter(hints, tr) : hints;
    for (const effect of tr.effects) {
      if (effect.is(setHints)) next = carryCounts(effect.value, next);
      if (effect.is(counted)) {
        const { namePos, usages } = effect.value;
        // A count that failed keeps what was shown rather than reading as none.
        const answer = usages === undefined ? { failed: true } : { usages, fresh: true };
        next = next.map((hint) => (hint.namePos === namePos ? { ...hint, ...answer } : hint));
      }
    }
    return next;
  },
});

const personIcon =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

class HintWidget extends WidgetType {
  constructor(
    readonly usages: string,
    readonly author: string | undefined,
    /** The declaration's own indent, so the hint lines up with it. */
    readonly indent: string,
  ) {
    super();
  }

  eq(other: HintWidget) {
    return other.usages === this.usages && other.author === this.author && other.indent === this.indent;
  }

  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "cm-vision";
    const indent = dom.appendChild(document.createElement("span"));
    indent.className = "cm-vision-indent";
    indent.textContent = this.indent;
    const usages = dom.appendChild(document.createElement("button"));
    usages.type = "button";
    usages.className = "cm-vision-usages";
    usages.textContent = this.usages;
    usages.addEventListener("mousedown", (event) => event.preventDefault());
    usages.addEventListener("click", () => {
      const line = view.state.doc.lineAt(view.posAtDOM(dom));
      const hint = view.state.field(hintsField).find((h) => h.namePos >= line.from && h.namePos <= line.to);
      if (hint) view.state.facet(visionHost)?.showUsages(view, hint.namePos);
    });
    if (this.author) {
      const author = dom.appendChild(document.createElement("span"));
      author.className = "cm-vision-author";
      const fresh = this.author === NEW_CODE;
      author.title = fresh ? "Not committed yet" : "Wrote most of these lines";
      if (!fresh) author.innerHTML = personIcon;
      author.append(this.author);
    }
    return dom;
  }

  ignoreEvent() {
    return true;
  }
}

function decorationsFor(state: EditorState) {
  const builder = new RangeSetBuilder<Decoration>();
  const hints = [...state.field(hintsField)].sort((a, b) => a.namePos - b.namePos);
  let lastLine = 0;
  for (const hint of hints) {
    const line = state.doc.lineAt(Math.min(hint.namePos, state.doc.length));
    if (line.number === lastLine) continue;
    lastLine = line.number;
    const indent = /^\s*/.exec(line.text)![0];
    const widget = new HintWidget(usagesLabel(hint.usages), hint.author, indent);
    builder.add(line.from, line.from, Decoration.widget({ widget, block: true, side: -1 }));
  }
  return builder.finish();
}

/** Asks the host for the usages of hints on screen that aren't counted for this text, one at a time. */
const counter = ViewPlugin.fromClass(
  class {
    private timer = 0;
    private counting = false;
    /** Asked to count while a count was running, so it counts again after. */
    private again = false;
    private gone = false;

    constructor(private readonly view: EditorView) {
      this.later();
    }

    update(update: ViewUpdate) {
      const hintsMoved = update.startState.field(hintsField) !== update.state.field(hintsField);
      if (update.viewportChanged || hintsMoved) this.later();
    }

    destroy() {
      this.gone = true;
      window.clearTimeout(this.timer);
    }

    private later() {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.count(), 400);
    }

    private async count() {
      const host = this.view.state.facet(visionHost);
      if (!host) return;
      if (this.counting) {
        this.again = true;
        return;
      }
      this.counting = true;
      try {
        for (;;) {
          const { from, to } = this.view.viewport;
          const next = this.view.state
            .field(hintsField)
            .find((hint) => !hint.fresh && !hint.failed && hint.namePos >= from && hint.namePos <= to);
          if (!next) return;
          const doc = this.view.state.doc;
          const usages = await host.countUsages(this.view, next.namePos).catch(() => undefined);
          if (this.gone) return;
          // An answer for text that has changed since is dropped and asked again.
          if (this.view.state.doc !== doc) {
            this.again = true;
            return;
          }
          this.view.dispatch({ effects: counted.of({ namePos: next.namePos, usages }) });
        }
      } finally {
        this.counting = false;
        if (this.again && !this.gone) {
          this.again = false;
          this.later();
        }
      }
    }
  },
);

const visionTheme = EditorView.theme({
  ".cm-vision": {
    display: "flex",
    alignItems: "center",
    height: "1.5em",
    // Lined up with the code under it: the editor's lines pad it, and the
    // indent keeps the code's font.
    paddingLeft: "6px",
    color: "color-mix(in srgb, var(--code-foreground) 45%, transparent)",
    whiteSpace: "pre",
    userSelect: "none",
  },
  ".cm-vision-usages, .cm-vision-author": {
    fontFamily: "var(--font-sans)",
    fontSize: "11.5px",
  },
  ".cm-vision-usages": {
    padding: "0",
    border: "none",
    background: "none",
    color: "inherit",
    cursor: "pointer",
  },
  ".cm-vision-usages:hover": { color: "var(--code-foreground)", textDecoration: "underline" },
  ".cm-vision-author": { display: "inline-flex", alignItems: "center", gap: "4px", marginLeft: "16px" },
});

/** PhpStorm's code vision: a line over each declaration with its usages and who wrote it. */
export const codeVision = (host: VisionHost) => [
  hintsField,
  EditorView.decorations.compute([hintsField], decorationsFor),
  counter,
  visionHost.of(host),
  visionTheme,
];
