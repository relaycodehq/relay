import { useEffect, type ComponentProps } from "react";
import type { Pull } from "../../../shared/types";
import { documents, type DocumentSource } from "./documents";
import type { ChangeBaseline } from "./editor-types";
import { FileEditor } from "./FileEditor";
import { baseExtensions } from "./setup";

type EditorProps = Omit<ComponentProps<typeof FileEditor>, "doc">;

/**
 * Where to put the caret, 1-based, and whether to show the file's changes
 * inline, against `baseline` when there is one; a new `nonce` asks again.
 */
export type Reveal = {
  line?: number;
  column?: number;
  changes?: boolean;
  baseline?: ChangeBaseline;
  nonce: number;
};

/**
 * A text file in the editor, its document kept in the window's store so it
 * keeps edits and undo history while its tab is behind another. Whoever
 * opened the tab closes the document (`documents.close`) with it.
 */
export default function TextFile({
  source,
  path,
  reveal,
  ...props
}: EditorProps & {
  source: DocumentSource;
  path: string;
  reveal?: Reveal;
}) {
  const doc = documents.get(source, path, baseExtensions);
  useEffect(() => {
    // Opened from the folder's own changes, the file shows them against its last commit again.
    if (reveal?.baseline || reveal?.changes) doc.compareWith(reveal.baseline);
    if (reveal?.changes || reveal?.baseline) doc.showChanges(true);
    if (reveal?.line) doc.reveal(reveal.line, reveal.column);
  }, [doc, reveal?.nonce]);
  return <FileEditor key={doc.key} doc={doc} {...props} />;
}

/** A PR's file in its linked checkout, in a modal of its own. */
export function PullFileEditor({
  pull,
  path,
  line,
  checks,
  onClose,
}: {
  pull: Pull;
  path: string;
  line?: number;
  checks: EditorProps["checks"];
  onClose: () => void;
}) {
  const source: DocumentSource = { kind: "pull", pull };
  const doc = documents.get(source, path, baseExtensions);
  useEffect(() => {
    if (line) doc.reveal(line);
    return () => documents.close(source, path);
  }, [doc]);
  return (
    <FileEditor
      doc={doc}
      target={pull}
      checks={checks}
      onClose={() => {
        documents.close(source, path, true);
        onClose();
      }}
    />
  );
}
