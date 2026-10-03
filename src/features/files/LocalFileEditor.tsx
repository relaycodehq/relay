import type { ReactNode } from "react";
import { FolderGit2 } from "lucide-react";
import type { Pull } from "../../../shared/types";
import { useContentHash } from "../checks/diagnostics";
import { editorKeys } from "./editor-keys";
import { useShortcutLabel } from "../../lib/shortcuts";
import { useBufferChecks } from "../checks/useBufferChecks";
import { useEditableDiff } from "./useEditableDiff";
import { useEditorCompare } from "./useEditorCompare";
import { useLocalFile, type LocalProject } from "./useLocalFile";
import type { ChecksController } from "../checks/useProjectChecks";
import { useSaveShortcut } from "./useSaveShortcut";
import { CheckPanel } from "./editor/CheckPanel";
import { EditCode } from "./editor/EditCode";
import { EditorBar } from "./editor/EditorBar";
import { EditorFooter } from "./editor/EditorFooter";
import { FolderPrompt, UnsavedPrompt } from "./editor/prompts";
import { useEditorBlame } from "./editor/useEditorBlame";
import { useSymbolNavigation } from "../diff/SymbolNavigation";
import { ErrorBox, Loading, Modal } from "../../ui/ui";

/** A file from a project's folder or a PR's checkout, edited against its committed version. */
export default function LocalFileEditor({
  checks,
  pull,
  project,
  inline = false,
  path,
  line,
  onClose,
  actions,
}: {
  checks: ChecksController;
  pull?: Pull;
  project?: LocalProject;
  inline?: boolean;
  path: string;
  line?: number;
  onClose: () => void;
  /** Extra buttons in the inline bar, after the editing controls. */
  actions?: ReactNode;
}) {
  const file = useLocalFile(project, pull, path, onClose);
  const { source } = file;
  const plain = !!project?.plain;
  const [compare, toggleCompare] = useEditorCompare(inline, plain);
  const hash = useContentHash(file.buffer);
  const base = project ? "HEAD" : "PR head";
  const target = pull ?? {
    projectId: project!.id,
    head: { sha: source?.head ?? project!.head },
  };
  const blame = useEditorBlame(
    target,
    path,
    file.revision,
    base,
    source?.original !== file.buffer,
    plain,
    compare ? "split" : "unified",
  );
  const symbols = useSymbolNavigation(
    target,
    path,
    hash,
    checks.state,
    "editing",
  );
  const { problems, markers } = useBufferChecks(
    checks,
    path,
    file.buffer,
    hash,
    file.setError,
  );
  const view = useEditableDiff(path, source, file.revision, line, markers);
  const saveKeys = useShortcutLabel("save");
  useSaveShortcut(file.save);
  return (
    <EditorFrame
      inline={inline}
      title={`Edit locally · ${path.split("/").pop()}`}
      className="local-editor-modal"
      onClose={file.requestClose}
    >
      {symbols.overlay}
      {inline && (
        <EditorBar
          path={path}
          file={file}
          editor={view.editor}
          symbols={symbols.controls}
          actions={actions}
          base={base}
          compare={compare}
          onCompare={plain ? undefined : toggleCompare}
          saveKeys={saveKeys}
        />
      )}
      <div
        className="local-editor-path"
        hidden={inline}
        title={source?.path ?? path}
      >
        <FolderGit2 size={14} />
        <span>
          {source?.path ??
            `${pull ? `${pull.owner}/${pull.name} · ` : ""}${path}`}
        </span>
        {source?.branch && <small>{source.branch}</small>}
      </div>
      {!!(file.error || view.error) && (
        <ErrorBox error={file.error || view.error} />
      )}
      {file.confirmation && (
        <UnsavedPrompt file={file} asking={file.confirmation} />
      )}
      {!source ? (
        <FolderPrompt file={file} />
      ) : (
        <>
          <CheckPanel
            checks={checks}
            path={path}
            hash={hash}
            problems={problems}
            editor={view.editor}
          />
          {!inline && symbols.controls}
          {blame.overlay}
          <div className="editor-versions" hidden={!compare}>
            <span>{base} · read-only</span>
            <span>Local working tree · editable</span>
          </div>
          <div
            className="local-editor-surface"
            {...blame.handlers}
            inert={file.loading}
            aria-busy={file.loading}
            onKeyDownCapture={editorKeys(view.editor, symbols.at)}
          >
            {!view.diff ? (
              <Loading text="Preparing editable diff…" />
            ) : (
              <EditCode
                view={view}
                symbols={symbols.handlers}
                compare={compare}
                onEdit={file.edit}
              />
            )}
          </div>
          {!inline && (
            <EditorFooter
              file={file}
              editor={view.editor}
              saveKeys={saveKeys}
            />
          )}
        </>
      )}
    </EditorFrame>
  );
}

function EditorFrame({
  inline,
  children,
  ...props
}: {
  inline: boolean;
  children: ReactNode;
  title: string;
  className: string;
  onClose: () => void;
}) {
  return inline ? (
    <section className="project-inline-editor" aria-label="Code editor">
      {children}
    </section>
  ) : (
    <Modal {...props}>{children}</Modal>
  );
}
