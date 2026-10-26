import type { ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import type { OpenTarget } from "./editor-types";
import type { FileDocument } from "./documents";
import { formatWithServer } from "./lsp-format";
import { pickItemAt, withPreviews } from "./lsp-picks";
import { isUnderCaret, placesAt, structureOf } from "./lsp-requests";
import { useLspDiagnostics } from "./useLspDiagnostics";
import { useLspPicker } from "./useLspPicker";
import { useLspRename } from "./useLspRename";

const DEFINITIONS = { title: "Definitions", empty: "No definition found." };
const USAGES = { title: "Usages", empty: "No usages found." };

const STRUCTURE = {
  title: "File structure",
  empty: "The server lists no symbols here.",
};

export type LspActions = ReturnType<typeof useLspActions>;

type LspActionsInput = {
  doc: FileDocument;
  where: string;
  /** A server covers this file. */
  enabled: boolean;
  onOpen: (target: OpenTarget) => void;
  onError: (error: unknown) => void;
};

/**
 * The language server's answers to the editor's keys: ⌘B and ⌘-click to the
 * definition, ⌥F7 usages, ⇧F6 rename across files, ⌘⌥L format, ⌘F12 the
 * file's structure. Each answers false when no server covers the file, so the
 * editor falls back to what the project's checks know.
 */
export function useLspActions({
  doc,
  where,
  enabled,
  onOpen,
  onError,
}: LspActionsInput) {
  const { show, jump, view } = useLspPicker(onOpen);
  const diagnostics = useLspDiagnostics(where, doc.path, enabled);
  const rename = useLspRename({ doc, where, enabled, onError });

  const itemsWithPreviews = (places: Parameters<typeof pickItemAt>[0][]) =>
    withPreviews(where, doc, places.map(pickItemAt));

  /** ⌥F7, and ⌘-click on a declaration: where it's used, straight there when that's one place. */
  const usages = async (view: EditorView, pos: number, jumpToOnly: boolean) => {
    show(USAGES);
    const found = await placesAt("references", where, doc.path, view, pos);
    const elsewhere = found.filter((place) => !isUnderCaret(place, doc.path, view, pos));
    if (jumpToOnly && elsewhere.length === 1) return jump(pickItemAt(elsewhere[0]));
    show({ ...USAGES, items: await itemsWithPreviews(elsewhere) });
  };

  // As in PhpStorm: on a usage it goes to the declaration, on the declaration it lists the usages.
  const definition = async (view: EditorView, pos: number) => {
    if (!enabled) return false;
    const found = await placesAt("definition", where, doc.path, view, pos);
    if (!found.length) return false;
    const onDeclaration = found.length === 1 && isUnderCaret(found[0], doc.path, view, pos);
    if (onDeclaration) await usages(view, pos, true);
    else if (found.length === 1) jump(pickItemAt(found[0]));
    else show({ ...DEFINITIONS, items: await itemsWithPreviews(found) });
    return true;
  };

  const references = async (view: EditorView, pos: number) => {
    if (!enabled) return false;
    await usages(view, pos, false);
    return true;
  };

  const fileStructure = async () => {
    if (!enabled) return false;
    show(STRUCTURE);
    show({ ...STRUCTURE, items: await structureOf(where, doc) });
    return true;
  };

  const format = async (view: EditorView) => {
    if (!enabled) return false;
    try {
      await formatWithServer(where, doc.path, view);
    } catch (error) {
      onError(error);
    }
    return true;
  };

  const overlay: ReactNode = (
    <>
      {view}
      {rename.field}
    </>
  );

  return {
    diagnostics,
    overlay,
    definition,
    references,
    fileStructure,
    format,
    rename: rename.start,
  };
}
