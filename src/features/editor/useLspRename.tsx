import { useState } from "react";
import type { EditorView } from "@codemirror/view";
import { lsp } from "../language-servers/client";
import type { FileDocument } from "./documents";
import { applyRename } from "./lsp-rename-edits";
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
      const outside = await applyRename(doc, where, view, files, asked);
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
