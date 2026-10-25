import type { EditorView } from "@codemirror/view";
import { lsp } from "../language-servers/client";
import type { FileDocument } from "./documents";
import { structureItems } from "./lsp-picks";
import { tellServerText } from "./lsp-sync";
import { positionAt } from "./positions";

/** Where the server says the symbol at `pos` is defined or used; none when it can't tell. */
export async function placesAt(
  ask: "definition" | "references",
  where: string,
  path: string,
  view: EditorView,
  pos: number,
) {
  // The server counts the position in the text it has heard.
  await tellServerText(where, path, view.state.sliceDoc());
  const { line, character } = positionAt(view.state.doc, pos);
  return lsp[ask](where, path, line, character).catch(() => []);
}

/** The symbols the server finds in `doc`, as picker rows. */
export async function structureOf(where: string, doc: FileDocument) {
  await tellServerText(where, doc.path, doc.text());
  const found = await lsp.documentSymbols(where, doc.path).catch(() => []);
  return structureItems(found.map((symbol) => ({ ...symbol, path: doc.path })));
}
