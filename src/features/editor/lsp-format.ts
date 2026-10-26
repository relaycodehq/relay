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
  const sent = view.state.doc;
  await tellServerText(where, path, sent);
  const edits = await lsp.format(where, path, {
    tabSize: view.state.tabSize,
    insertSpaces: !view.state.facet(indentUnit).includes("\t"),
  });
  if (!edits.length) return;
  // The edits' positions are in the text that was sent; on newer text they land in the wrong places.
  if (view.state.doc !== sent)
    throw new Error("The file changed while formatting. Format it again.");
  view.dispatch({
    changes: lspChanges(view.state.doc, edits),
    userEvent: "input.format",
  });
}
