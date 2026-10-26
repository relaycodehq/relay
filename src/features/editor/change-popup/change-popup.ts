import { EditorSelection, Facet, Prec, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import { barClicked, comparedText, inlineBars } from "../change-gutter";
import { codeRuns } from "../hover-card/highlight-runs";
import { mountChangePopup } from "./ChangePopup";
import {
  changeOnLine,
  comparedDoc,
  comparedWith,
  fileChanges,
  removedLines,
  rollbackEdit,
  type FileChange,
} from "./file-changes";

/** What the popup asks of the editor's host. */
export type ChangeHost = {
  /** Commits only this change; absent when the bars don't compare with the last commit. */
  commit?: (change: { compared: string; content: string; message: string }) => Promise<void>;
  /** Writes a commit message for this change. */
  suggest?: (change: { compared: string; content: string }) => Promise<string>;
  toggleInline: () => void;
};

export const changeHost = Facet.define<ChangeHost, ChangeHost | undefined>({
  combine: (values) => values[0],
});

/** The change the popup is open on, and the line it hangs below. */
type OpenPopup = { change: FileChange; below: number };

const setPopup = StateEffect.define<OpenPopup | null>();

/** The popup for a change: under its removal's gap, or under the line clicked. */
function popupAt(state: EditorState, line: number): OpenPopup | null {
  const change = changeOnLine(fileChanges(state) ?? [], line);
  return change ? { change, below: belowFor(change, line) } : null;
}

/** A removal's popup hangs in its gap, so the lines it took out show where they were. */
const belowFor = (change: FileChange, line: number) =>
  change.added ? line : Math.max(1, change.line - 1);

const popupField = StateField.define<OpenPopup | null>({
  create: () => null,
  update(open, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPopup)) return effect.value;
      if (effect.is(barClicked)) return popupAt(tr.state, effect.value);
    }
    const closes = tr.docChanged || tr.isUserEvent("select.pointer");
    return closes ? null : open;
  },
  provide: (field) =>
    showTooltip.compute([field], (state) => {
      const open = state.field(field);
      return open && tooltipFor(state, open);
    }),
});

function tooltipFor(state: EditorState, open: OpenPopup): Tooltip {
  const { doc } = state;
  return {
    pos: doc.line(Math.min(open.below, doc.lines)).from,
    create: (view) => {
      const popup = mountChangePopup(popupProps(view, open.change));
      // A click anywhere else closes it, as a click on another bar opens that one.
      const outside = (event: PointerEvent) => {
        if (!event.composedPath().includes(popup.dom)) close(view);
      };
      document.addEventListener("pointerdown", outside, true);
      return {
        dom: popup.dom,
        offset: { x: -6, y: 2 },
        destroy: () => {
          document.removeEventListener("pointerdown", outside, true);
          popup.destroy();
        },
      };
    },
  };
}

const close = (view: EditorView) => {
  if (view.state.field(popupField, false)) view.dispatch({ effects: setPopup.of(null) });
};

function popupProps(view: EditorView, change: FileChange) {
  const { state } = view;
  const host = state.facet(changeHost);
  const compared = comparedDoc(state)!;
  const comparedRaw = state.facet(comparedText) ?? "";
  const inlineShown = !!state.field(inlineBars, false);
  const changes = fileChanges(state) ?? [];
  const at = changes.findIndex((c) => c.line === change.line && c.oldLine === change.oldLine);
  const old = removedLines(compared, change).join(state.lineBreak);
  const content = () => comparedWith(comparedRaw, view.state.doc, view.state.lineBreak, change);
  const step = (by: number) => () => {
    const next = changes[at + by];
    if (!next) return;
    const line = Math.min(next.line, view.state.doc.lines);
    const pos = view.state.doc.line(line).from;
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: [
        EditorView.scrollIntoView(pos, { y: "center" }),
        setPopup.of({ change: next, below: belowFor(next, line) }),
      ],
      userEvent: "select",
    });
  };
  const commit = host?.commit;
  const suggest = host?.suggest;
  return {
    removed: change.removed && !inlineShown ? codeRuns(state, old) : undefined,
    hasPrevious: at > 0,
    hasNext: at >= 0 && at < changes.length - 1,
    inlineShown,
    onPrevious: step(-1),
    onNext: step(1),
    onRollback: () => {
      view.dispatch({
        changes: rollbackEdit(compared, view.state.doc, view.state.lineBreak, change),
        userEvent: "input.rollback",
      });
      view.focus();
    },
    onToggleInline: () => {
      close(view);
      host?.toggleInline();
    },
    onCopy: change.removed ? () => void navigator.clipboard.writeText(old) : undefined,
    commit: commit
      ? async (message: string) => {
          await commit({ compared: comparedRaw, content: content(), message });
          close(view);
        }
      : undefined,
    suggest: suggest ? () => suggest({ compared: comparedRaw, content: content() }) : undefined,
    onClose: () => {
      close(view);
      view.focus();
    },
  };
}

const escapeCloses = Prec.highest(
  keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (!view.state.field(popupField, false)) return false;
        close(view);
        return true;
      },
    },
  ]),
);

/** PhpStorm's popup on a change bar, for what the host lets it do. */
export const changePopup = (host: ChangeHost) => [popupField, escapeCloses, changeHost.of(host)];
