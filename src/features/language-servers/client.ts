import type {
  LspDiagnostic,
  LspLineSpan,
  LspStatusEvent,
} from "../../../shared/language-servers";
import type { Api } from "../../../shared/types";
import { api } from "../../lib/api";

/** The call looked up when made, so importing this needs no window bridge. */
const call = <M extends keyof Api & `lsp${string}`>(method: M) =>
  ((...args: unknown[]) =>
    (api[method] as (...a: unknown[]) => unknown)(...args)) as Api[M];

/**
 * Language-server calls, as the editor makes them. `where` is the workspace
 * id, `path` is relative to its folder (absolute outside it), and positions
 * are 0-based with UTF-16 characters.
 */
export const lsp = {
  open: call("lspOpen"),
  change: call("lspChange"),
  save: call("lspSave"),
  close: call("lspClose"),
  hover: call("lspHover"),
  definition: call("lspDefinition"),
  references: call("lspReferences"),
  completion: call("lspCompletion"),
  rename: call("lspRename"),
  format: call("lspFormat"),
  documentSymbols: call("lspDocumentSymbols"),
  inlayHints: call("lspInlayHints"),
  workspaceSymbols: call("lspWorkspaceSymbols"),
  readFile: call("lspReadFile"),
  status: call("lspStatus"),
};

/**
 * The last diagnostics each file was sent, by folder and path. The main
 * process sends them once, so an editor mounted again after a tab switch
 * reads them here instead of waiting for a change.
 */
const lastDiagnostics = new Map<string, LspDiagnostic[]>();
let keepingDiagnostics = false;

const fileKey = (where: string, path: string) => `${where}\0${path}`;

function keepDiagnostics() {
  if (keepingDiagnostics) return;
  keepingDiagnostics = true;
  api.onLspDiagnostics((event) => {
    const key = fileKey(event.where, event.path);
    if (event.diagnostics.length) lastDiagnostics.set(key, event.diagnostics);
    else lastDiagnostics.delete(key);
  });
}

/** Hears what the servers report for one file, now and whenever it changes. */
export function onLspDiagnostics(
  where: string,
  path: string,
  callback: (diagnostics: LspDiagnostic[]) => void,
) {
  keepDiagnostics();
  const known = lastDiagnostics.get(fileKey(where, path));
  if (known) callback(known);
  return api.onLspDiagnostics((event) => {
    if (event.where === where && event.path === path)
      callback(event.diagnostics);
  });
}

/** Hears which lines of one file the compiler leaves out, now and whenever that changes. */
export function onLspInactiveLines(
  where: string,
  path: string,
  callback: (lines: LspLineSpan[]) => void,
) {
  return api.onLspInactiveLines((event) => {
    if (event.where === where && event.path === path) callback(event.lines);
  });
}

/** Hears every state change of the servers of one workspace. */
export function onLspStatus(
  where: string,
  callback: (event: LspStatusEvent) => void,
) {
  return api.onLspStatus((event) => {
    if (event.where === where) callback(event);
  });
}
