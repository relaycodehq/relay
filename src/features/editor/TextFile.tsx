import { useEffect, useRef, type ComponentProps } from "react";
import type { Pull } from "../../../shared/types";
import { documents, type DocumentSource, type FileDocument } from "./documents";
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

/** The reveal each document last showed, by its nonce. */
const revealed = new WeakMap<FileDocument, number>();

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
    // Switching back to the tab mounts this again with the same reveal, already done.
    if (!reveal || revealed.get(doc) === reveal.nonce) return;
    revealed.set(doc, reveal.nonce);
    // Opened from the folder's own changes, the file shows them against its last commit again.
    if (reveal.baseline || reveal.changes) doc.compareWith(reveal.baseline);
    if (reveal.changes || reveal.baseline) doc.showChanges(true);
    if (reveal.line) doc.reveal(reveal.line, reveal.column);
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
  const shown = useRef(false);
  useEffect(() => {
    shown.current = true;
    if (line) doc.reveal(line);
    return () => {
      shown.current = false;
      // StrictMode runs the effect again at once in development; only an
      // editor that stays gone lets its document go.
      queueMicrotask(() => {
        if (!shown.current) documents.close(source, path);
      });
    };
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
