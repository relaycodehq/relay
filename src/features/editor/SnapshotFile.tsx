import { useMemo, type ReactNode } from "react";
import type { CodeReference } from "../../../shared/code-references";
import type { ChangeBaseline } from "../../../shared/editor-windows";
import { EditorPath } from "../../ui/EditorPath";
import { SnapshotView } from "./SnapshotView";
import { useAskSelection } from "./useAskSelection";
import { inlineChanges } from "./useEditorChanges";

/**
 * A version of a file that isn't on disk, like a commit's: read-only, with
 * its changes since `baseline` in place when it has one.
 */
export function SnapshotFile({
  lead,
  path,
  label,
  text,
  baseline,
  onAsk,
}: {
  /** Before the path, like the file list's toggle. */
  lead?: ReactNode;
  path: string;
  /** Which version it is. */
  label: string;
  text: string;
  baseline?: ChangeBaseline;
  onAsk?: (ref: CodeReference) => void;
}) {
  const ask = useAskSelection(path, label, onAsk);
  const extensions = useMemo(
    () => [ask ?? [], baseline ? inlineChanges(baseline.text) : []],
    [ask, baseline],
  );
  return (
    <section className="project-inline-editor snapshot-file" aria-label="File version">
      <SnapshotView path={path} text={text} label={`${path} at ${label}`} extensions={extensions} />
      <div className="editor-bar">
        {lead}
        <EditorPath path={path}>
          <span className="editor-bar-state">{label} · read-only</span>
        </EditorPath>
        <span className="editor-bar-gap" />
        {baseline && <span className="editor-bar-baseline">Changes since {baseline.label}</span>}
      </div>
    </section>
  );
}
