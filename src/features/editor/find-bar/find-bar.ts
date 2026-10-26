import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers, type Command, type Panel, type ViewUpdate } from "@codemirror/view";
import { FindBar, type QueryFields } from "./FindBar";
import { findMatches, matchCount, matchFrom, matchNumber, type Matches } from "./find-matches";
import { findBarTheme } from "./find-bar-theme";

const showReplace = StateEffect.define<boolean>();

const replaceShown = StateField.define<boolean>({
  create: () => false,
  update(shown, tr) {
    for (const effect of tr.effects) if (effect.is(showReplace)) shown = effect.value;
    return shown;
  },
});

/** ⌘F: the find row, folding the replace row away. */
export const openFind: Command = (view) => {
  view.dispatch({ effects: showReplace.of(false) });
  return openSearchPanel(view);
};

/** ⌘R: find and replace. */
export const openReplace: Command = (view) => {
  if (view.state.readOnly) return openFind(view);
  view.dispatch({ effects: showReplace.of(true) });
  return openSearchPanel(view);
};

class FindPanel implements Panel {
  readonly dom = document.createElement("div");
  readonly top = true;
  private readonly root = createRoot(this.dom);
  private query: SearchQuery;
  private matches: Matches;
  /** Where typing finds from: the caret when the bar opened or was last moved by hand. */
  private findsFrom: number;

  constructor(private readonly view: EditorView) {
    this.dom.className = "cm-find";
    this.dom.addEventListener("keydown", (event) => this.keydown(event));
    this.query = getSearchQuery(view.state);
    this.matches = findMatches(view.state, this.query);
    this.findsFrom = view.state.selection.main.from;
    // Drawn at once, so the code below it doesn't jump when it fills in.
    flushSync(() => this.render(view.state));
  }

  mount() {
    const field = this.dom.querySelector<HTMLInputElement>("[main-field]");
    field?.focus();
    field?.select();
  }

  update(update: ViewUpdate) {
    const query = getSearchQuery(update.state);
    const queryMoved = !query.eq(this.query);
    if (queryMoved || update.docChanged) this.matches = findMatches(update.state, query);
    this.query = query;
    const movedByHand = update.transactions.some(
      (tr) => tr.selection && !tr.isUserEvent("select.search"),
    );
    // Replace All moves no selection, but the text it replaced moves where finding starts.
    if (update.docChanged) this.findsFrom = update.changes.mapPos(this.findsFrom);
    if (movedByHand) this.findsFrom = update.state.selection.main.from;
    const replaceMoved = update.startState.field(replaceShown) !== update.state.field(replaceShown);
    if (queryMoved || update.docChanged || update.selectionSet || replaceMoved) this.render(update.state);
  }

  destroy() {
    this.root.unmount();
  }

  private render(state: EditorState) {
    const { view } = this;
    const current = matchNumber(this.matches.starts, state.selection.main);
    this.root.render(
      createElement(FindBar, {
        query: this.query,
        count: matchCount(this.query, this.matches, current),
        found: this.matches.starts.length > 0,
        replacing: state.field(replaceShown) && !state.readOnly,
        onToggleReplace: state.readOnly
          ? undefined
          : () => view.dispatch({ effects: showReplace.of(!view.state.field(replaceShown)) }),
        onQuery: (fields) => this.setQuery(fields),
        onNext: () => findNext(view),
        onPrevious: () => findPrevious(view),
        onSelectAll: () => {
          selectMatches(view);
          view.focus();
        },
        onReplace: () => replaceNext(view),
        onReplaceAll: () => replaceAll(view),
        onClose: () => closeSearchPanel(view),
      }),
    );
  }

  /** Takes the fields' query, and like PhpStorm selects its first match on from the caret as it's typed. */
  private setQuery(fields: QueryFields) {
    const { literal, replace } = this.query;
    const query = new SearchQuery({ ...fields, literal });
    if (query.eq(this.query)) return;
    const onlyReplaceMoved = new SearchQuery({ ...fields, literal, replace }).eq(this.query);
    const match =
      !onlyReplaceMoved && query.valid ? matchFrom(this.view.state, query, this.findsFrom) : undefined;
    this.view.dispatch({
      effects: match
        ? [setSearchQuery.of(query), EditorView.scrollIntoView(match.from, { y: "center" })]
        : setSearchQuery.of(query),
      selection: match ? EditorSelection.range(match.from, match.to) : undefined,
      userEvent: "select.search",
    });
  }

  private keydown(event: KeyboardEvent) {
    if (event.isComposing) return; // the key belongs to the input method
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
      return;
    }
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    if (event.target.hasAttribute("main-field")) (event.shiftKey ? findPrevious : findNext)(this.view);
    else (event.metaKey || event.ctrlKey ? replaceAll : replaceNext)(this.view);
  }
}

/** Find and replace in a PhpStorm-style bar above the code. */
export const findBar = [
  search({ top: true, createPanel: (view) => new FindPanel(view) }),
  replaceShown,
  findBarTheme,
];
