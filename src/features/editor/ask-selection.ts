import { Prec, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";

/** The most lines one question can cover, the same limit as in diffs. */
const MAX_LINES = 200;

/** The whole lines the main selection covers, 1-based; null when nothing is selected. */
export function selectedLines(state: EditorState) {
  const { from, to, empty } = state.selection.main;
  if (empty) return null;
  const first = state.doc.lineAt(from);
  let last = state.doc.lineAt(to);
  // A selection ending at the start of a line, as a line-number drag does, stops on the line before.
  if (to === last.from && last.number > first.number) last = state.doc.line(last.number - 1);
  return {
    start: first.number,
    end: last.number,
    code: state.sliceDoc(first.from, last.to),
  };
}

/**
 * "Ask in chat" over the selection, and ⌥⏎ for it: JetBrains keeps its AI
 * actions on that key too.
 */
export function askSelection(ask: (view: EditorView) => void, keys: string): Extension {
  /** Asks, then collapses the selection to the caret, as the diff view does. */
  const run = (view: EditorView) => {
    ask(view);
    view.dispatch({ selection: { anchor: view.state.selection.main.head } });
  };
  const tooltip = (state: EditorState): readonly Tooltip[] => {
    const lines = selectedLines(state);
    if (!lines) return [];
    const tooMany = lines.end - lines.start + 1 > MAX_LINES;
    return [
      {
        pos: state.selection.main.from,
        above: true,
        arrow: false,
        create: (view) => {
          const dom = document.createElement("div");
          dom.className = "cm-ask-selection";
          if (tooMany) {
            dom.textContent = `Select up to ${MAX_LINES} lines to ask about them.`;
            return { dom };
          }
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Ask in chat";
          // A click on the button must not move the caret first, or the selection would be lost.
          button.onmousedown = (e) => e.preventDefault();
          button.onclick = () => run(view);
          const hint = document.createElement("kbd");
          hint.textContent = keys;
          button.append(hint);
          dom.append(button);
          return { dom };
        },
      },
    ];
  };
  const field = StateField.define<readonly Tooltip[]>({
    create: tooltip,
    update(value, tr) {
      // A match the find bar selected isn't something picked to ask about.
      if (tr.isUserEvent("select.search")) return [];
      return tr.docChanged || tr.selection ? tooltip(tr.state) : value;
    },
    provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
  });
  return [
    field,
    Prec.high(
      keymap.of([
        {
          key: "Alt-Enter",
          run: (view) => {
            const lines = selectedLines(view.state);
            if (!lines || lines.end - lines.start + 1 > MAX_LINES) return false;
            run(view);
            return true;
          },
        },
      ]),
    ),
  ];
}
