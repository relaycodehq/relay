import { z } from "zod";

// Code intelligence from language servers (LSP), run by the main process per
// workspace folder. Positions are 0-based line and UTF-16 character, as in
// LSP. A path is relative to the workspace folder, with `/` separators; a file
// outside it (a standard library, node_modules) comes back absolute.

export type LspServerId =
  "rust-analyzer" | "clangd" | "vtsls" | "intelephense" | "pyright" | "gopls";

/**
 * starting: launching, or restarting after a crash. indexing: running, but
 * still loading the project. ready, stopped (idle, or the last file closed).
 * downloading: fetching the server for the first time. missing: not on PATH
 * and Relay can't fetch it (`message` says what to install). failed: it
 * crashed repeatedly or couldn't start (`message` says why).
 */
export type LspState =
  | "starting"
  | "indexing"
  | "ready"
  | "downloading"
  | "missing"
  | "failed"
  | "stopped";

export interface LspServerStatus {
  /** Display name of the server, e.g. `rust-analyzer`. */
  server: string;
  /** What it serves: `rust`, `cpp`, `typescript`, `php`, `python` or `go`. */
  language: string;
  state: LspState;
  message?: string;
  /** Percent, 0 to 100, while downloading or when the server reports one. */
  progress?: number;
}

export interface LspStatusEvent extends LspServerStatus {
  where: string;
}

export type LspSeverity = "error" | "warning" | "info" | "hint";

export interface LspRange {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
}

export interface LspDiagnostic extends LspRange {
  severity: LspSeverity;
  message: string;
  source?: string;
  code?: string;
}

export interface LspDiagnosticsEvent {
  where: string;
  path: string;
  /** Everything the server reports for the file now; empty clears it. */
  diagnostics: LspDiagnostic[];
}

/** Lines from `from` to `to`, 0-based, both included. */
export interface LspLineSpan {
  from: number;
  to: number;
}

/** The code the compiler leaves out of a file, such as another platform's `#ifdef`; clangd reports it. */
export interface LspInactiveLinesEvent {
  where: string;
  path: string;
  /** Everything left out now; empty clears it. */
  lines: LspLineSpan[];
}

export interface LspLocation extends LspRange {
  path: string;
  /** The file is outside the workspace folder; `path` is absolute. */
  outside: boolean;
}

export interface LspEdit extends LspRange {
  newText: string;
}

export interface LspFileEdits {
  path: string;
  edits: LspEdit[];
}

export type LspSymbolKind =
  | "file"
  | "module"
  | "namespace"
  | "package"
  | "class"
  | "method"
  | "property"
  | "field"
  | "constructor"
  | "enum"
  | "interface"
  | "function"
  | "variable"
  | "constant"
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "key"
  | "null"
  | "enumMember"
  | "struct"
  | "event"
  | "operator"
  | "typeParameter"
  | "keyword"
  | "text"
  | "snippet"
  | "unit"
  | "value"
  | "color"
  | "reference"
  | "folder";

export interface LspHover {
  markdown: string;
  range?: LspRange;
}

export interface LspCompletionItem {
  label: string;
  kind: LspSymbolKind;
  detail?: string;
  /** What to insert, as plain text (snippets are turned off). */
  insertText: string;
  /** The text the item replaces, when the server says; else the word before the caret. */
  replace?: LspRange;
  /** Matches the typed text against this instead of `label`. */
  filterText?: string;
  sortText?: string;
  /** Markdown. */
  documentation?: string;
  /** Edits elsewhere in the file that come with it, such as an import. */
  additionalEdits?: LspEdit[];
  deprecated?: boolean;
}

export interface LspCompletions {
  items: LspCompletionItem[];
  /** More would match with more typing, or the list was cut short. */
  incomplete: boolean;
}

export interface LspSymbol {
  name: string;
  kind: LspSymbolKind;
  path: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
  /** The symbol this one is inside. */
  container?: string;
  detail?: string;
}

/** What the server shows inside the code: a type after a name, or a parameter's name before an argument. */
export interface LspInlayHint {
  line: number;
  character: number;
  label: string;
  kind: "type" | "parameter" | "other";
  paddingLeft: boolean;
  paddingRight: boolean;
}

export interface LspOpened {
  /** The server's name; null when no language server covers this file. */
  server: string | null;
  status: LspServerStatus | null;
}

export interface LspFormatOptions {
  tabSize: number;
  insertSpaces: boolean;
}

/**
 * Language servers for the editor. A file is opened before anything else is
 * asked about it, and one editor holds a (workspace, path) at a time: a second
 * `lspClose` closes it for both. Queries answer empty while the server isn't
 * running or is still starting, `lspRename` and `lspFormat` refuse with the
 * reason. Rename edits aren't applied here: the editor applies them to open
 * buffers and saves the other files through the project file calls.
 */
export interface LanguageServersApi {
  lspOpen(where: string, path: string, text: string): Promise<LspOpened>;
  /** The whole text; the server hears of it a moment later, or before the next query. */
  lspChange(where: string, path: string, text: string): Promise<void>;
  /** The file was saved; rust-analyzer checks the project then. */
  lspSave(where: string, path: string): Promise<void>;
  lspClose(where: string, path: string): Promise<void>;
  lspHover(
    where: string,
    path: string,
    line: number,
    character: number,
  ): Promise<LspHover | null>;
  lspDefinition(
    where: string,
    path: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]>;
  lspReferences(
    where: string,
    path: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]>;
  lspCompletion(
    where: string,
    path: string,
    line: number,
    character: number,
  ): Promise<LspCompletions>;
  lspRename(
    where: string,
    path: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<LspFileEdits[]>;
  lspFormat(
    where: string,
    path: string,
    options?: LspFormatOptions,
  ): Promise<LspEdit[]>;
  lspDocumentSymbols(where: string, path: string): Promise<LspSymbol[]>;
  /** The hints in lines `fromLine` up to `toLine`, 0-based. */
  lspInlayHints(where: string, path: string, fromLine: number, toLine: number): Promise<LspInlayHint[]>;
  lspWorkspaceSymbols(where: string, query: string): Promise<LspSymbol[]>;
  /** The file's text, for an outside path a location pointed at. Refuses any other. */
  lspReadFile(where: string, path: string): Promise<string>;
  /** Servers this workspace has used, running or not. */
  lspStatus(where: string): Promise<LspServerStatus[]>;
  onLspDiagnostics(callback: (event: LspDiagnosticsEvent) => void): () => void;
  onLspInactiveLines(callback: (event: LspInactiveLinesEvent) => void): () => void;
  onLspStatus(callback: (event: LspStatusEvent) => void): () => void;
}

const absolutePath = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

/** A path in the workspace (no `..`) or an absolute one outside it. */
export const lspPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes("\0"), "Invalid path")
  .refine(
    (p) =>
      absolutePath.test(p) ||
      (!p.includes("\\") && !p.split("/").some((part) => part === "..")),
    "Path leaves the workspace",
  );

const coordinate = z.number().int().min(0).max(100_000_000);
export const lspLineSchema = coordinate;
export const lspCharacterSchema = coordinate;
export const lspNewNameSchema = z
  .string()
  .max(500)
  .refine((n) => n.trim().length > 0, "Give it a name");
export const lspFormatOptionsSchema = z
  .object({
    tabSize: z.number().int().min(1).max(16),
    insertSpaces: z.boolean(),
  })
  .strict();
export const lspQuerySchema = z.string().max(500);

/** The server and the id the editor tells the server a file is, by extension. */
const extensions: Record<string, [LspServerId, string]> = {
  rs: ["rust-analyzer", "rust"],
  c: ["clangd", "c"],
  h: ["clangd", "cpp"],
  cc: ["clangd", "cpp"],
  cpp: ["clangd", "cpp"],
  cxx: ["clangd", "cpp"],
  "c++": ["clangd", "cpp"],
  hh: ["clangd", "cpp"],
  hpp: ["clangd", "cpp"],
  hxx: ["clangd", "cpp"],
  ipp: ["clangd", "cpp"],
  m: ["clangd", "objective-c"],
  mm: ["clangd", "objective-cpp"],
  cu: ["clangd", "cuda-cpp"],
  ts: ["vtsls", "typescript"],
  mts: ["vtsls", "typescript"],
  cts: ["vtsls", "typescript"],
  tsx: ["vtsls", "typescriptreact"],
  js: ["vtsls", "javascript"],
  mjs: ["vtsls", "javascript"],
  cjs: ["vtsls", "javascript"],
  jsx: ["vtsls", "javascriptreact"],
  php: ["intelephense", "php"],
  phtml: ["intelephense", "php"],
  py: ["pyright", "python"],
  pyi: ["pyright", "python"],
  go: ["gopls", "go"],
};

/** Which language server covers a file, from its name; null for the rest. */
export function lspServerFor(path: string) {
  const name = path.slice(
    Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1,
  );
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const found = extensions[name.slice(dot + 1).toLowerCase()];
  return found ? { server: found[0], languageId: found[1] } : null;
}

const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;

/** Where the line starting at `from` ends, where the next one starts, and whether it was the last. */
function lineEnd(text: string, from: number) {
  for (let i = from; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === LINE_FEED) return { end: i, next: i + 1, isLast: false };
    if (code === CARRIAGE_RETURN) {
      const crlf = text.charCodeAt(i + 1) === LINE_FEED;
      return { end: i, next: crlf ? i + 2 : i + 1, isLast: false };
    }
  }
  return { end: text.length, next: text.length, isLast: true };
}

/** The offset of a line and character in `text`, clamped to the line it names. */
export function offsetAt(text: string, line: number, character: number) {
  let start = 0;
  for (let l = 0; l < line; l++) {
    const { next, isLast } = lineEnd(text, start);
    if (isLast) return text.length;
    start = next;
  }
  return Math.min(start + character, lineEnd(text, start).end);
}

/** `text` with the edits applied; they all refer to the original, as a server sends them. */
export function applyLspEdits(text: string, edits: readonly LspEdit[]) {
  const resolved = edits
    .map((edit, order) => ({
      order,
      from: offsetAt(text, edit.line, edit.character),
      to: offsetAt(text, edit.endLine, edit.endCharacter),
      newText: edit.newText,
    }))
    .sort((a, b) => a.from - b.from || a.order - b.order);
  // Built front to back from the original text, so edits at one offset
  // (an insert, then a replace) land in the order the server gave them.
  let out = "";
  let at = 0;
  for (const edit of resolved) {
    out += text.slice(at, edit.from) + edit.newText;
    at = Math.max(at, edit.to);
  }
  return out + text.slice(at);
}
