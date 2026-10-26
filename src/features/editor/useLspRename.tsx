import { useState } from "react";
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { applyLspEdits, type LspFileEdits } from "../../../shared/language-servers";
import { api } from "../../lib/api";
import { lsp } from "../language-servers/client";
import { documents, type FileDocument } from "./documents";
import { lspChanges } from "./lsp";
import { isOutsidePath } from "./lsp-picks";
import { heardTexts, tellServerText } from "./lsp-sync";
import { positionAt } from "./positions";
import { RenameField } from "./SymbolPicker";

type Renaming = {
  view: EditorView;
  /** Where the symbol starts. */
  pos: number;
  word: string;
  at: { left: number; top: number; bottom: number };
  busy: boolean;
};

/**
 * The open files edited since the server was asked. Its edits are positioned
 * in the text it was sent (`asked`), so on these they'd land in the wrong places.
 */
function editedSinceAsked(
  doc: FileDocument,
  view: EditorView,
  files: LspFileEdits[],
  asked: Map<string, Text>,
) {
  if (doc.source.kind !== "project") return [];
  const source = doc.source;
  const bufferOf = (path: string) =>
    path === doc.path ? view.state.doc : documents.find(source, path)?.state?.doc;
  return files
    .map((file) => file.path)
    .filter((path) => {
      const buffer = bufferOf(path);
      const sent = asked.get(path);
      return buffer && sent && !buffer.eq(sent);
    });
}

/**
 * Applies each file's edits: in the open buffer when the file is open (unsaved,
 * undoable), straight to disk when it isn't. Returns the files outside the
 * project, which are left alone.
 */
async function applyEverywhere(
  doc: FileDocument,
  where: string,
  view: EditorView,
  files: LspFileEdits[],
) {
  const source = doc.source;
  const outside: string[] = [];
  if (source.kind !== "project") return outside;
  for (const file of files) {
    if (file.path === doc.path) {
      view.dispatch({
        changes: lspChanges(view.state.doc, file.edits),
        userEvent: "input.rename",
      });
    } else if (isOutsidePath(file.path)) {
      outside.push(file.path);
    } else {
      const open = documents.find(source, file.path);
      if (open?.state) {
        open.edit({
          changes: lspChanges(open.state.doc, file.edits),
          userEvent: "input.rename",
        });
      } else {
        const read = await api.projectFile(where, file.path);
        await api.saveProjectFile(
          where,
          file.path,
          read.head,
          read.version,
          applyLspEdits(read.contents, file.edits),
        );
      }
    }
  }
  return outside;
}

/** Rename across files: the field over the symbol, and the server's edits once a name is chosen. */
export function useLspRename({
  doc,
  where,
  enabled,
  onError,
}: {
  doc: FileDocument;
  where: string;
  /** A server covers this file. */
  enabled: boolean;
  onError: (error: unknown) => void;
}) {
  const [renaming, setRenaming] = useState<Renaming>();

  const start = (view: EditorView, pos: number) => {
    if (!enabled) return false;
    const word = view.state.wordAt(pos);
    const coords = view.coordsAtPos(word?.from ?? pos);
    if (!word || !coords) return false;
    setRenaming({
      view,
      pos: word.from,
      word: view.state.sliceDoc(word.from, word.to),
      at: coords,
      busy: false,
    });
    return true;
  };

  const finish = async (name: string) => {
    if (!renaming) return;
    const { view, pos } = renaming;
    setRenaming({ ...renaming, busy: true });
    try {
      await tellServerText(where, doc.path, view.state.doc);
      const asked = heardTexts(where);
      const { line, character } = positionAt(view.state.doc, pos);
      const files = await lsp.rename(where, doc.path, line, character, name);
      const edited = editedSinceAsked(doc, view, files, asked);
      if (edited.length)
        throw new Error(`Nothing was renamed: ${edited.join(", ")} changed meanwhile. Rename again.`);
      const outside = await applyEverywhere(doc, where, view, files);
      if (outside.length)
        onError(new Error(`Left alone outside the project: ${outside.join(", ")}`));
      setRenaming(undefined);
      view.focus();
    } catch (error) {
      setRenaming(undefined);
      onError(error);
    }
  };

  const field = renaming && (
    <RenameField
      at={renaming.at}
      initial={renaming.word}
      busy={renaming.busy}
      onRename={(name) => void finish(name)}
      onClose={() => {
        setRenaming(undefined);
        renaming.view.focus();
      }}
    />
  );
  return { start, field };
}
