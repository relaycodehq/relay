import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { Diagnostic } from "@codemirror/lint";
import { EditorState, type Text } from "@codemirror/state";
import { closeHoverTooltips, hoverTooltip } from "@codemirror/view";
import type {
  LspCompletionItem,
  LspDiagnostic,
  LspEdit,
  LspSymbolKind,
} from "../../../shared/language-servers";
import { lsp } from "../language-servers/client";
import type { OpenTarget } from "./editor-types";
import { mountHoverCard } from "./hover-card/HoverCard";
import { inactiveCode } from "./inactive-code";
import { inlayHints } from "./inlay-hints";
import { tellServerText } from "./lsp-sync";
import { offsetAt, positionAt } from "./positions";

const severities: Record<LspDiagnostic["severity"], Diagnostic["severity"]> = {
  error: "error",
  warning: "warning",
  info: "info",
  hint: "hint",
};

/** A server's diagnostics as CodeMirror's, squiggles under their ranges. */
export function lspDiagnostics(doc: Text, found: readonly LspDiagnostic[]): Diagnostic[] {
  return found.map((d) => {
    const from = offsetAt(doc, d.line, d.character);
    return {
      from,
      to: Math.max(from, offsetAt(doc, d.endLine, d.endCharacter)),
      severity: severities[d.severity],
      message: d.message,
      ...(d.source ? { source: d.code ? `${d.source} ${d.code}` : d.source } : {}),
    };
  });
}

/** CodeMirror changes for edits a server sent against the text as it is now. */
export function lspChanges(doc: Text, edits: readonly LspEdit[]) {
  return edits.map((edit) => ({
    from: offsetAt(doc, edit.line, edit.character),
    to: offsetAt(doc, edit.endLine, edit.endCharacter),
    insert: edit.newText,
  }));
}

const completionTypes: Partial<Record<LspSymbolKind, string>> = {
  method: "method",
  function: "function",
  constructor: "function",
  field: "property",
  property: "property",
  variable: "variable",
  class: "class",
  struct: "class",
  interface: "interface",
  enum: "enum",
  enumMember: "enum",
  module: "namespace",
  namespace: "namespace",
  keyword: "keyword",
  constant: "constant",
  typeParameter: "type",
  text: "text",
};

/** TypeScript answers every hover with this until it has read the project; the next hover asks again. */
const stillLoading = (markdown: string) => markdown.includes("(loading...)");

function hoverDocs(where: string, path: string, onOpen: (target: OpenTarget) => void) {
  return hoverTooltip(
    async (view, pos) => {
      const { line, character } = positionAt(view.state.doc, pos);
      await tellServerText(where, path, view.state.doc);
      const declared = lsp
        .definition(where, path, line, character)
        .then((places) => places[0], () => undefined);
      const found = await lsp.hover(where, path, line, character).catch(() => null);
      if (!found?.markdown.trim() || stillLoading(found.markdown)) return null;
      const range = found.range;
      return {
        pos: range ? offsetAt(view.state.doc, range.line, range.character) : pos,
        end: range ? offsetAt(view.state.doc, range.endLine, range.endCharacter) : pos,
        above: true,
        create: (view) =>
          mountHoverCard(view.state, found.markdown, declared, (target) => {
            view.dispatch({ effects: closeHoverTooltips });
            onOpen(target);
          }),
      };
    },
    { hoverTime: 450 },
  );
}

/** A suggestion's docs as a hover would have them: its signature as code, then the rest. */
function completionDocs(item: LspCompletionItem) {
  const signature = item.detail ? "```\n" + item.detail + "\n```\n\n" : "";
  return signature + (item.documentation ?? "");
}

/** One suggestion, applying the server's own replace range and any extra edits (like an import). */
function completionOption(item: LspCompletionItem, index: number, state: EditorState): Completion {
  return {
    label: item.label,
    detail: item.detail,
    type: completionTypes[item.kind],
    boost: -index / 1000,
    ...(item.documentation ? { info: () => mountHoverCard(state, completionDocs(item)) } : {}),
    apply: (view, _completion, applyFrom, applyTo) => {
      const doc = view.state.doc;
      const range = item.replace;
      const start = range ? offsetAt(doc, range.line, range.character) : applyFrom;
      const end = range
        ? Math.max(applyTo, offsetAt(doc, range.endLine, range.endCharacter))
        : applyTo;
      const changes = view.state.changes([
        { from: start, to: end, insert: item.insertText },
        ...lspChanges(doc, item.additionalEdits ?? []),
      ]);
      view.dispatch({
        changes,
        selection: { anchor: changes.mapPos(end, 1) },
        userEvent: "input.complete",
      });
    },
  };
}

const MAX_SUGGESTIONS = 300;

function completions(where: string, path: string) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/[\w$]+/);
    const afterTrigger = /[.:>]$/.test(
      context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos),
    );
    if (!context.explicit && !word && !afterTrigger) return null;
    const { line, character } = positionAt(context.state.doc, context.pos);
    await tellServerText(where, path, context.state.doc);
    if (context.aborted) return null;
    const found = await lsp
      .completion(where, path, line, character)
      .catch(() => ({ items: [], incomplete: false }));
    if (context.aborted || !found.items.length) return null;
    return {
      from: word?.from ?? context.pos,
      options: found.items
        .slice(0, MAX_SUGGESTIONS)
        .map((item, index) => completionOption(item, index, context.state)),
      ...(found.incomplete ? {} : { validFor: /^[\w$]*$/ }),
    };
  };
}

/**
 * Hover docs and completions for a file a language server covers. The
 * server answers from the text it last heard, so the current text is sent
 * before each query.
 */
export function lspFeatures(where: string, path: string, onOpen: (target: OpenTarget) => void) {
  // One source for the file's life: autocompletion takes a new one for a new
  // kind of completion and starts its query again, which never settles.
  const source = completions(where, path);
  return [
    hoverDocs(where, path, onOpen),
    EditorState.languageData.of(() => [{ autocomplete: source }]),
    inlayHints(where, path),
    inactiveCode(where, path),
  ];
}
