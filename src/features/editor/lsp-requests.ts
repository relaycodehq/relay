import type { EditorView } from "@codemirror/view";
import type { LspLocation } from "../../../shared/language-servers";
import { lsp } from "../language-servers/client";
import type { FileDocument } from "./documents";
import { structureItems } from "./lsp-picks";
import { tellServerText } from "./lsp-sync";
import { offsetAt, positionAt } from "./positions";

/** Where the server says the symbol at `pos` is defined or used; none when it can't tell. */
export async function placesAt(
  ask: "definition" | "references",
  where: string,
  path: string,
  view: EditorView,
  pos: number,
) {
  // The server counts the position in the text it has heard.
  await tellServerText(where, path, view.state.doc);
  const { line, character } = positionAt(view.state.doc, pos);
  return lsp[ask](where, path, line, character).catch(() => []);
}

/** `place` is the symbol at `pos` in the file at `path`, as when the caret sits on a declaration. */
export function isUnderCaret(place: LspLocation, path: string, view: EditorView, pos: number) {
  if (place.outside || place.path !== path) return false;
  const text = view.state.doc;
  const from = offsetAt(text, place.line, place.character);
  const to = offsetAt(text, place.endLine, place.endCharacter);
  return from <= pos && pos <= to;
}

/** How many places use the symbol at `pos`, its declaration not counted. */
export async function usageCount(where: string, path: string, view: EditorView, pos: number) {
  const found = await placesAt("references", where, path, view, pos);
  return found.filter((place) => !isUnderCaret(place, path, view, pos)).length;
}

/** The symbols the server finds in `doc`, as picker rows. */
export async function structureOf(where: string, doc: FileDocument) {
  if (doc.state) await tellServerText(where, doc.path, doc.state.doc);
  const found = await lsp.documentSymbols(where, doc.path).catch(() => []);
  return structureItems(found.map((symbol) => ({ ...symbol, path: doc.path })));
}
