import { useState } from "react";
import { FolderGit2, History } from "lucide-react";
import type { LocalFile } from "../../../shared/types";
import { ErrorBox, IconButton, Modal } from "../../ui/ui";
import { LspStatusText } from "../language-servers/LspStatusText";
import { CheckPanel } from "./CheckPanel";
import type { DocumentSource } from "./documents";
import { EditorBar } from "./EditorBar";
import type { FileEditorProps } from "./editor-types";
import { EditorFooter } from "./EditorFooter";
import { EditorSurface } from "./EditorSurface";
import { LocalHistoryDialog } from "./LocalHistoryDialog";
import {
  isMarkdown,
  MarkdownModes,
  MarkdownSplitView,
  useMarkdownMode,
} from "./MarkdownPreview";
import { FolderPrompt } from "./prompts";
import { useFileEditor, type FileEditorState } from "./useFileEditor";
import "./editor.css";

export type { EditorTarget, OpenTarget } from "./editor-types";

/**
 * A file from a project's folder or a PR's checkout in the code editor, with
 * change bars against its committed version, blame on the line numbers, the
 * project's checks as squiggles, and Markdown's preview beside it. Inline it
 * sits in the Files pane under a bar; otherwise it opens in a modal.
 */
export function FileEditor(props: FileEditorProps) {
  return props.inline ? <InlineFileEditor {...props} /> : <ModalFileEditor {...props} />;
}

function InlineFileEditor(props: FileEditorProps) {
  const editor = useFileEditor(props);
  const { doc, status, file, changes, intelligence } = editor;
  const { path, source } = doc;
  const where = source.kind === "project" ? source.where : undefined;
  const [showHistory, setShowHistory] = useState(false);
  const [markdownMode, setMarkdownMode] = useMarkdownMode();
  const markdownIn = where !== undefined && isMarkdown(path) ? where : undefined;
  const code = <Code editor={editor} />;
  return (
    <section className="project-inline-editor" aria-label="Code editor">
      <Overlays editor={editor} />
      {!!editor.error && <ErrorBox error={editor.error} />}
      {showHistory && where !== undefined && (
        <LocalHistoryDialog
          where={where}
          path={path}
          current={doc.text()}
          theme={editor.theme}
          view={editor.getView}
          onClose={() => setShowHistory(false)}
        />
      )}
      {editor.unsaved.prompt}
      {editor.blame.overlay}
      {markdownIn === undefined ? (
        code
      ) : (
        <MarkdownSplitView
          mode={markdownMode}
          where={markdownIn}
          path={path}
          text={editor.text ?? ""}
          onOpenLink={props.onOpenLink}
        >
          {code}
        </MarkdownSplitView>
      )}
      <EditorBar
        lead={props.lead}
        path={props.shownPath ?? path}
        title={props.shownPath ?? file?.path ?? path}
        status={status}
        modes={markdownIn && <MarkdownModes mode={markdownMode} onMode={setMarkdownMode} />}
        servers={intelligence.served ? <LspStatusText where={where} /> : undefined}
        checks={<EditorChecks editor={editor} checks={props.checks} />}
        actions={
          <>
            {where !== undefined && (
              <IconButton label="Local history" onClick={() => setShowHistory(true)}>
                <History size={14} />
              </IconButton>
            )}
            {props.actions}
          </>
        }
        base={editor.headLabel}
        compare={changes.showDiff}
        onCompare={editor.plain || editor.baseline ? undefined : changes.toggleDiff}
        baseline={
          editor.baseline && {
            label: editor.baseline.label,
            onDrop: () => doc.compareWith(undefined),
          }
        }
        saveKeys={editor.saveKeys}
        onSave={editor.save}
        onReload={editor.unsaved.requestReload}
      />
    </section>
  );
}

/** A PR's file, edited in its linked checkout. */
function ModalFileEditor(props: FileEditorProps) {
  const editor = useFileEditor(props);
  const { doc, status, file, unsaved } = editor;
  const needsFolder = !doc.state && doc.source.kind === "pull";
  return (
    <Modal
      title={`Edit locally · ${doc.path.split("/").pop()}`}
      className="local-editor-modal"
      onClose={unsaved.requestClose}
    >
      <Overlays editor={editor} />
      <FilePathLine source={doc.source} path={doc.path} file={file} />
      {!!editor.error && <ErrorBox error={editor.error} />}
      {unsaved.prompt}
      {needsFolder ? (
        <FolderPrompt status={status} onLoad={(link) => void doc.load(link)} />
      ) : (
        <>
          <EditorChecks editor={editor} checks={props.checks} />
          {editor.blame.overlay}
          <Code editor={editor} />
          <EditorFooter
            status={status}
            saveKeys={editor.saveKeys}
            view={editor.getView}
            onReload={unsaved.requestReload}
            onDone={unsaved.requestClose}
            onSave={editor.save}
          />
        </>
      )}
    </Modal>
  );
}

/** The symbol and language-server pickers, which float over the editor. */
function Overlays({ editor }: { editor: FileEditorState }) {
  return (
    <>
      {editor.intelligence.symbols.overlay}
      {editor.intelligence.lspActions.overlay}
    </>
  );
}

/** Where the project's checks stand on the file, and its problems to jump to. */
function EditorChecks({
  editor,
  checks,
}: {
  editor: FileEditorState;
  checks: FileEditorProps["checks"];
}) {
  return (
    <CheckPanel
      checks={checks}
      path={editor.doc.path}
      hash={editor.hash}
      problems={editor.intelligence.problems}
      editor={editor.getView}
    />
  );
}

function Code({ editor }: { editor: FileEditorState }) {
  const { intelligence } = editor;
  return (
    <EditorSurface
      doc={editor.doc}
      loading={editor.status.loading}
      slots={{
        theme: editor.theme ?? [],
        changes: editor.changes.extension,
        actions: intelligence.slots.actions,
        host: intelligence.slots.host,
      }}
      handlers={editor.blame.handlers}
      onView={editor.onView}
    />
  );
}

/** The modal's line naming the file, and the branch it is on. */
function FilePathLine({
  source,
  path,
  file,
}: {
  source: DocumentSource;
  path: string;
  file: LocalFile | undefined;
}) {
  const name =
    source.kind === "pull" ? `${source.pull.owner}/${source.pull.name} · ${path}` : path;
  return (
    <div className="local-editor-path" title={file?.path ?? path}>
      <FolderGit2 size={14} />
      <span>{name}</span>
      {file?.branch && <small>{file.branch}</small>}
    </div>
  );
}
