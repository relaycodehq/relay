import type {
  LspCompletionItem,
  LspCompletions,
  LspDiagnostic,
  LspEdit,
  LspFileEdits,
  LspHover,
  LspInlayHint,
  LspLineSpan,
  LspLocation,
  LspRange,
  LspSeverity,
  LspSymbol,
  LspSymbolKind,
} from "../../shared/language-servers";
import type { Paths } from "./uri";

// LSP's shapes in, Relay's out. Servers are loose about what they send, so
// nothing here trusts a field to be present.

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

function rangeOf(value: unknown): LspRange | undefined {
  if (!isObject(value) || !isObject(value.start) || !isObject(value.end))
    return undefined;
  const [line, character, endLine, endCharacter] = [
    num(value.start.line),
    num(value.start.character),
    num(value.end.line),
    num(value.end.character),
  ];
  if (
    line === undefined ||
    character === undefined ||
    endLine === undefined ||
    endCharacter === undefined
  )
    return undefined;
  return { line, character, endLine, endCharacter };
}

const symbolKinds: LspSymbolKind[] = [
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enumMember",
  "struct",
  "event",
  "operator",
  "typeParameter",
];

const completionKinds: LspSymbolKind[] = [
  "text",
  "method",
  "function",
  "constructor",
  "field",
  "variable",
  "class",
  "interface",
  "module",
  "property",
  "unit",
  "value",
  "enum",
  "keyword",
  "snippet",
  "color",
  "file",
  "reference",
  "folder",
  "enumMember",
  "constant",
  "struct",
  "event",
  "operator",
  "typeParameter",
];

const symbolKindOf = (item: Json): LspSymbolKind =>
  symbolKinds[(num(item.kind) ?? 1) - 1] ?? "object";

const severities: Record<number, LspSeverity> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

/** A result that may be one item or a list, as a list. */
function listOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  return result ? [result] : [];
}

/** A completion result is a list of items, or an object holding them. */
function completionItemsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (isObject(result) && Array.isArray(result.items)) return result.items;
  return [];
}

/** The most completions sent to the editor; the server's own order decides which. */
export const MAX_COMPLETIONS = 500;

/** Thrown for a rename or format the editor can't carry out. */
export class UnsupportedEdit extends Error {}

/** Converts what one server says, for the workspace folder it works in. */
export class Converter {
  constructor(
    private root: string,
    private paths: Paths,
    /** Told of every file outside the folder that a result points at. */
    private sawOutside: (file: string) => void = () => {},
    /** Other names of the folder, such as its real path. */
    private aliases: string[] = [],
  ) {}

  /** The editor's name for the file a URI names; undefined for URIs that aren't files. */
  locate(uri: unknown): { path: string; outside: boolean } | undefined {
    const file = typeof uri === "string" ? this.paths.fromUri(uri) : undefined;
    if (file === undefined) return undefined;
    const found = this.paths.toWorkspacePath(this.root, file, this.aliases);
    if (found.outside) this.sawOutside(found.path);
    return found;
  }

  hover(result: unknown): LspHover | null {
    if (!isObject(result)) return null;
    const markdown = markdownOf(result.contents).trim();
    if (!markdown) return null;
    const range = rangeOf(result.range);
    return range ? { markdown, range } : { markdown };
  }

  locations(result: unknown): LspLocation[] {
    const out: LspLocation[] = [];
    for (const item of listOf(result)) {
      if (!isObject(item)) continue;
      const link = "targetUri" in item;
      const where = this.locate(link ? item.targetUri : item.uri);
      const range = rangeOf(
        link ? (item.targetSelectionRange ?? item.targetRange) : item.range,
      );
      if (where && range) out.push({ ...where, ...range });
    }
    return out;
  }

  completions(result: unknown): LspCompletions {
    const items = completionItemsOf(result)
      .filter(isObject)
      .sort((a, b) => byCodeUnits(sortKey(a), sortKey(b)));
    const incomplete =
      items.length > MAX_COMPLETIONS ||
      (isObject(result) && result.isIncomplete === true);
    return {
      items: items.slice(0, MAX_COMPLETIONS).flatMap((item) => {
        const converted = this.completionItem(item);
        return converted ? [converted] : [];
      }),
      incomplete,
    };
  }

  private completionItem(item: Json): LspCompletionItem | undefined {
    const label = str(item.label);
    if (!label) return undefined;
    const edit = isObject(item.textEdit) ? item.textEdit : undefined;
    // An InsertReplaceEdit has both ranges; the insert one ends at the caret.
    const replace = rangeOf(edit?.range ?? edit?.insert);
    const text = str(edit?.newText) ?? str(item.insertText) ?? label;
    const details = isObject(item.labelDetails) ? item.labelDetails : {};
    const labelDetails = [str(details.detail), str(details.description)]
      .filter(Boolean)
      .join(" ");
    const detail = str(item.detail) ?? (labelDetails || undefined);
    const documentation = markdownOf(item.documentation).trim();
    const additional = this.edits(item.additionalTextEdits);
    const tags = Array.isArray(item.tags) ? item.tags : [];
    return {
      label,
      kind: completionKinds[(num(item.kind) ?? 1) - 1] ?? "text",
      ...(detail ? { detail } : {}),
      insertText: item.insertTextFormat === 2 ? plainSnippet(text) : text,
      ...(replace ? { replace } : {}),
      ...(str(item.filterText) ? { filterText: str(item.filterText) } : {}),
      ...(str(item.sortText) ? { sortText: str(item.sortText) } : {}),
      ...(documentation ? { documentation } : {}),
      ...(additional.length ? { additionalEdits: additional } : {}),
      ...(item.deprecated === true || tags.includes(1)
        ? { deprecated: true }
        : {}),
    };
  }

  edits(result: unknown): LspEdit[] {
    if (!Array.isArray(result)) return [];
    return result.flatMap((edit) => {
      if (!isObject(edit) || typeof edit.newText !== "string") return [];
      const range = rangeOf(edit.range);
      return range ? [{ ...range, newText: edit.newText }] : [];
    });
  }

  /** A rename's edits by file. Throws if the server also wants files created, moved or deleted. */
  workspaceEdit(result: unknown): LspFileEdits[] {
    if (!isObject(result)) return [];
    const byFile = new Map<string, LspFileEdits>();
    const add = (uri: unknown, edits: unknown) => {
      const where = this.locate(uri);
      if (!where) return;
      const found = byFile.get(where.path) ?? { path: where.path, edits: [] };
      found.edits.push(...this.edits(edits));
      byFile.set(where.path, found);
    };
    if (Array.isArray(result.documentChanges))
      for (const change of result.documentChanges) {
        if (!isObject(change)) continue;
        if (typeof change.kind === "string")
          throw new UnsupportedEdit(
            "The rename wants to create, move or delete files, which Relay can't do yet.",
          );
        add(
          isObject(change.textDocument) ? change.textDocument.uri : undefined,
          change.edits,
        );
      }
    else if (isObject(result.changes))
      for (const [uri, edits] of Object.entries(result.changes))
        add(uri, edits);
    return [...byFile.values()].filter((f) => f.edits.length);
  }

  diagnostics(list: unknown): LspDiagnostic[] {
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      if (!isObject(item) || typeof item.message !== "string") return [];
      const range = rangeOf(item.range);
      if (!range) return [];
      const code = isObject(item.code) ? item.code.value : item.code;
      return [
        {
          ...range,
          severity: severities[num(item.severity) ?? 1] ?? "error",
          message: item.message,
          ...(str(item.source) ? { source: str(item.source) } : {}),
          ...(typeof code === "string" || typeof code === "number"
            ? { code: String(code) }
            : {}),
        },
      ];
    });
  }

  /** A file's outline, flattened; children come after their parent with its name as `container`. */
  documentSymbols(result: unknown, file: { path: string }): LspSymbol[] {
    if (!Array.isArray(result)) return [];
    const out: LspSymbol[] = [];
    const walk = (items: unknown[], container?: string) => {
      for (const item of items) {
        if (!isObject(item) || typeof item.name !== "string") continue;
        // A flat SymbolInformation carries its own location instead of nesting.
        if (isObject(item.location)) {
          const symbol = this.symbolAtLocation(item, item.name, item.location);
          if (symbol) out.push(symbol);
          continue;
        }
        const symbol = nestedSymbol(item, item.name, file.path, container);
        if (!symbol) continue;
        out.push(symbol);
        if (Array.isArray(item.children)) walk(item.children, item.name);
      }
    };
    walk(result);
    return out;
  }

  private symbolAtLocation(
    item: Json,
    name: string,
    location: Json,
  ): LspSymbol | undefined {
    const where = this.locate(location.uri);
    const range = rangeOf(location.range);
    if (!where || !range) return undefined;
    return {
      name,
      kind: symbolKindOf(item),
      path: where.path,
      line: range.line,
      character: range.character,
      endLine: range.endLine,
      endCharacter: range.endCharacter,
      ...(str(item.containerName)
        ? { container: str(item.containerName) }
        : {}),
    };
  }

  workspaceSymbols(result: unknown): LspSymbol[] {
    if (!Array.isArray(result)) return [];
    return result.flatMap((item) => {
      if (!isObject(item) || typeof item.name !== "string") return [];
      const location = isObject(item.location) ? item.location : undefined;
      const where = this.locate(location?.uri);
      if (!where) return [];
      // A WorkspaceSymbol may name only the file; the editor opens it at the top.
      const range = rangeOf(location?.range);
      return [
        {
          name: item.name,
          kind: symbolKindOf(item),
          path: where.path,
          line: range?.line ?? 0,
          character: range?.character ?? 0,
          ...(str(item.containerName)
            ? { container: str(item.containerName) }
            : {}),
        },
      ];
    });
  }
}

/** A DocumentSymbol: it sits in the file being outlined and may hold more. */
function nestedSymbol(
  item: Json,
  name: string,
  path: string,
  container: string | undefined,
): LspSymbol | undefined {
  const start = rangeOf(item.selectionRange) ?? rangeOf(item.range);
  if (!start) return undefined;
  const whole = rangeOf(item.range) ?? start;
  const detail = str(item.detail);
  return {
    name,
    kind: symbolKindOf(item),
    path,
    line: start.line,
    character: start.character,
    endLine: whole.endLine,
    endCharacter: whole.endCharacter,
    ...(container ? { container } : {}),
    ...(detail ? { detail } : {}),
  };
}

/** MarkupContent, a MarkedString or a list of them, as Markdown. */
function markdownOf(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents))
    return contents
      .map(markdownOf)
      .filter((part) => part.trim())
      .join("\n\n");
  if (!isObject(contents) || typeof contents.value !== "string") return "";
  // MarkedString: {language, value} is a code block.
  if (typeof contents.language === "string")
    return "```" + contents.language + "\n" + contents.value + "\n```";
  return contents.value;
}

/** A snippet as the text it would insert, for a server that sends one though snippets are off. */
export function plainSnippet(snippet: string) {
  return snippet.replace(
    /\\([$}\\])|\$\{\d+:([^}]*)\}|\$\{\d+\|([^,}|]*)[^}]*\}|\$\{?\d+\}?/g,
    (_, escaped?: string, placeholder?: string, choice?: string) =>
      escaped ?? placeholder ?? choice ?? "",
  );
}

const HINT_KINDS: Record<number, LspInlayHint["kind"]> = { 1: "type", 2: "parameter" };

/** InlayHint[]: a label (a string or parts) at a position, with LSP's kinds 1 for types and 2 for parameters. */
export function inlayHintsOf(result: unknown): LspInlayHint[] {
  if (!Array.isArray(result)) return [];
  return result.flatMap((item): LspInlayHint[] => {
    if (!isObject(item) || !isObject(item.position)) return [];
    const [line, character] = [num(item.position.line), num(item.position.character)];
    const label = Array.isArray(item.label)
      ? item.label.map((part) => (isObject(part) ? (str(part.value) ?? "") : "")).join("")
      : str(item.label);
    if (line === undefined || character === undefined || !label) return [];
    const kind = HINT_KINDS[num(item.kind) ?? 0] ?? "other";
    return [{ line, character, label, kind, paddingLeft: item.paddingLeft === true, paddingRight: item.paddingRight === true }];
  });
}

/** Range[] of clangd's `textDocument/inactiveRegions`, as the whole lines they cover. */
export function inactiveLinesOf(regions: unknown): LspLineSpan[] {
  if (!Array.isArray(regions)) return [];
  return regions.flatMap((region): LspLineSpan[] => {
    const range = rangeOf(region);
    if (!range) return [];
    // A range that ends at the start of a line leaves that line out.
    const to = range.endCharacter === 0 && range.endLine > range.line ? range.endLine - 1 : range.endLine;
    return [{ from: range.line, to }];
  });
}

/** What LSP sorts a completion by: its sortText, else its label. */
const sortKey = (item: Record<string, unknown>) =>
  str(item.sortText) ?? str(item.label) ?? "";

/** Servers write sortText for a plain string comparison, not a locale's. */
function byCodeUnits(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
