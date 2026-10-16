import type { ReactNode } from "react";
import { FolderGit2 } from "lucide-react";
import type { Pull } from "../../../../shared/types";
import { useContentHash } from "../../checks/diagnostics";
import { editorKeys } from "./editor-keys";
import { useShortcutLabel } from "../../../lib/shortcuts";
import { useBufferChecks } from "../../checks/useBufferChecks";
import { useEditorCompare } from "./useEditorCompare";
import { useLocalFile, type LocalProject } from "./useLocalFile";
import type { ChecksController } from "../../checks/useProjectChecks";
import { useSaveShortcut } from "./useSaveShortcut";
import { CheckPanel } from "./CheckPanel";
import { EditCode } from "./EditCode";
import { EditorBar } from "./EditorBar";
import { EditorFooter } from "./EditorFooter";
import {
  isMarkdown,
  MarkdownModes,
  MarkdownPreview,
  MarkdownSplitter,
  useMarkdownMode,
  useMarkdownSplit,
} from "./MarkdownPreview";
import { FolderPrompt, UnsavedPrompt } from "./prompts";
import { useChangeBars } from "./useChangeBars";
import { useEditorBlame } from "./useEditorBlame";
import { useEditorView } from "./useEditorView";
import { useSymbolNavigation } from "../../diff/SymbolNavigation";
import { ErrorBox, Loading, Modal } from "../../../ui/ui";

/**
 * A file from a project's folder or a PR's checkout, edited with change bars
 * against its committed version, or beside it when comparing.
 */
export default function LocalFileEditor({
  checks,
  pull,
  project,
  inline = false,
  path,
  shownPath,
  line,
  onClose,
  lead,
  actions,
  stamp,
  onOpenLink,
}: {
  checks: ChecksController;
  pull?: Pull;
  project?: LocalProject;
  inline?: boolean;
  path: string;
  /** What the bar shows instead of `path`, like a file's full path outside the project. */
  shownPath?: string;
  line?: number;
  onClose: () => void;
  /** Before the path in the inline bar. */
  lead?: ReactNode;
  /** Extra buttons in the inline bar, after the editing controls. */
  actions?: ReactNode;
  /** Changes when the file may have changed on disk, like the working tree's revision. */
  stamp?: string;
  /** Opens a file or folder a Markdown preview links to. */
  onOpenLink?: (target: { path: string; directory: boolean }) => void;
}) {
  const file = useLocalFile(project, pull, path, onClose, stamp);
  const { source } = file;
  const plain = !!project?.plain;
  const [compare, toggleCompare] = useEditorCompare(inline, plain);
  const hash = useContentHash(file.buffer);
  const base = project ? "HEAD" : "PR head";
  const target = pull ?? {
    projectId: project!.id,
    head: { sha: source?.head ?? project!.head },
  };
  // Only the file by itself: comparing shows the diff instead, and a folder
  // without Git has no committed version to mark changes against.
  const bars = useChangeBars(
    plain || compare ? undefined : source?.original,
    file.buffer,
  );
  const blame = useEditorBlame(target, path, file.revision, base, {
    plain,
    compare,
    edited: source?.original !== file.buffer,
    hunks: bars.hunks,
  });
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
  const view = useEditorView({
    path,
    source,
    revision: file.revision,
    buffer: file.buffer,
    compare,
    line,
    markers,
    quiet: file.quiet,
  });
  const saveKeys = useShortcutLabel("save");
  useSaveShortcut(file.save);
  const markdown = inline && !!project && isMarkdown(path);
  const [mode, setMode] = useMarkdownMode();
  const [share, setShare] = useMarkdownSplit();
  const shown = markdown ? mode : "code";
  const code = (
    <>
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
        onPointerDownCapture={view.editable ? undefined : view.startEditing}
      >
        {!view.ready ? (
          <Loading text="Comparing…" />
        ) : (
          <EditCode
            view={view}
            symbols={symbols.handlers}
            onRender={bars.attach}
            onEdit={file.edit}
          />
        )}
      </div>
    </>
  );
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
          lead={lead}
          path={shownPath ?? path}
          title={shownPath}
          file={file}
          editor={view.editor}
          symbols={symbols.controls}
          modes={markdown && <MarkdownModes mode={mode} onMode={setMode} />}
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
          {markdown ? (
            <div className={`markdown-split ${shown}`}>
              {/* Kept mounted in Preview, so the editor keeps its undo and scroll. */}
              <div
                className="markdown-split-code"
                hidden={shown === "preview"}
                style={
                  shown === "split"
                    ? { flex: `0 0 ${share * 100}%` }
                    : undefined
                }
              >
                {code}
              </div>
              {shown === "split" && (
                <MarkdownSplitter share={share} onShare={setShare} />
              )}
              {shown !== "code" && (
                <MarkdownPreview
                  where={project.id}
                  path={path}
                  text={file.buffer ?? ""}
                  onOpen={onOpenLink}
                />
              )}
            </div>
          ) : (
            code
          )}
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
