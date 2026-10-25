import { indentUnit } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { lsp } from "../language-servers/client";
import { lspChanges } from "./lsp";
import { tellServerText } from "./lsp-sync";

/** Formats the whole file with the server's edits; throws when the server refuses. */
export async function formatWithServer(
  where: string,
  path: string,
  view: EditorView,
) {
  await tellServerText(where, path, view.state.sliceDoc());
  const edits = await lsp.format(where, path, {
    tabSize: view.state.tabSize,
    insertSpaces: !view.state.facet(indentUnit).includes("\t"),
  });
  if (!edits.length) return;
  view.dispatch({
    changes: lspChanges(view.state.doc, edits),
    userEvent: "input.format",
  });
}
