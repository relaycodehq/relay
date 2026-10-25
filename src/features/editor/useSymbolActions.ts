import { useMemo, useRef, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type { SymbolQuery } from "../../../shared/checks";
import { api } from "../../lib/api";
import type { useSymbolNavigation } from "../diff/SymbolNavigation";
import { moveCaretTo } from "./caret";
import type { EditorTarget, HostSearches, OpenTarget } from "./editor-types";
import { symbolActions, type SymbolActions } from "./keymap";
import type { LspActions } from "./useLspActions";

type Inputs = {
  path: string;
  /** A language server covers the file. */
  served: boolean;
  /** Of the text the checks last ran on. */
  hash: string | undefined;
  target: EditorTarget;
  symbols: ReturnType<typeof useSymbolNavigation>;
  lspActions: LspActions;
  onOpenFile?: (target: OpenTarget) => void;
  onBack?: () => boolean;
  onForward?: () => boolean;
  host?: HostSearches;
  onError: (error: unknown) => void;
};

const inspect = (target: EditorTarget, query: SymbolQuery) =>
  "projectId" in target
    ? api.inspectLocalSymbol(target.projectId, target.head.sha, query)
    : api.inspectSymbol(target, target.head.sha, query);

/** The caret's 1-based line and column, as the checks count them. */
function lineAndColumn(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  return { line: line.number, column: pos - line.from + 1 };
}

/**
 * What the editor's keys do with the symbol at the caret: ⌘B and ⌘-click to
 * the definition, usages, rename, format, Back and Forward and the searches the
 * host offers. The language server answers first; the project's checks know
 * TypeScript too and answer when no server covers the file.
 */
export function useSymbolActions(inputs: Inputs) {
  const { path, served } = inputs;
  // The keys are bound once per file; the latest inputs are read when one is pressed.
  const latest = useRef(inputs);
  latest.current = inputs;
  return useMemo(() => symbolActions.of(actionsFor(path, served, latest)), [path, served]);
}

function actionsFor(path: string, served: boolean, latest: RefObject<Inputs>): SymbolActions {
  /** The host keeps the trail Back follows, so it gets same-file jumps too. Without a host the caret just moves. */
  const goTo = (view: EditorView, to: OpenTarget) => {
    const { onOpenFile } = latest.current;
    if (onOpenFile) return onOpenFile(to);
    if (to.path === path && to.line) moveCaretTo(view, to.line, to.column);
  };

  const fromHost = (name: keyof HostSearches) => (view: EditorView, pos: number) =>
    latest.current.host?.[name]?.(view, pos) ?? false;

  const definition = (view: EditorView, pos: number) => {
    const { hash, symbols, target, lspActions, onError } = latest.current;
    const hashForChecks = symbols.ready ? hash : undefined;
    if (!served && !hashForChecks) return false;
    const { line, column } = lineAndColumn(view, pos);
    const definitionFromChecks = async () => {
      if (!hashForChecks) return;
      const result = await inspect(target, {
        path,
        hash: hashForChecks,
        line,
        column,
        kind: "definition",
      });
      const [only, ...others] = result.locations;
      if (!only || others.length) return symbols.at(line, column, "definition");
      // On the declaration itself, its usages instead, as in PhpStorm.
      const word = view.state.wordAt(pos);
      const wordColumn = word ? word.from - view.state.doc.lineAt(pos).from + 1 : column;
      const onDeclaration = only.path === path && only.line === line && only.column === wordColumn;
      if (onDeclaration) return symbols.at(line, column, "references");
      goTo(view, { path: only.path, line: only.line, column: only.column });
    };
    const serverAnswer = served ? lspActions.definition(view, pos) : Promise.resolve(false);
    void serverAnswer
      .then((found) => (found ? undefined : definitionFromChecks()))
      .catch(onError);
    return true;
  };

  const references = (view: EditorView, pos: number) => {
    const { hash, symbols, lspActions } = latest.current;
    if (served) {
      void lspActions.references(view, pos);
      return true;
    }
    if (!hash || !symbols.ready) return false;
    const { line, column } = lineAndColumn(view, pos);
    symbols.at(line, column, "references");
    return true;
  };

  return {
    searchEverywhere: fromHost("searchEverywhere"),
    goToFile: fromHost("goToFile"),
    goToSymbol: fromHost("goToSymbol"),
    recentFiles: fromHost("recentFiles"),
    findInFiles: fromHost("findInFiles"),
    replaceInFiles: fromHost("replaceInFiles"),
    definition,
    references,
    back: () => latest.current.onBack?.() ?? false,
    forward: () => latest.current.onForward?.() ?? false,
    rename: (view, pos) => latest.current.lspActions.rename(view, pos),
    format: (view) => {
      void latest.current.lspActions.format(view);
      return served;
    },
    fileStructure: () => {
      void latest.current.lspActions.fileStructure();
      return served;
    },
  };
}
