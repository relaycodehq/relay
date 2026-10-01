import { EditorPath } from "./EditorPath";
import { useSymbolNavigation } from "./SymbolNavigation";
import { useLineBlame } from "./LineBlame";
import type { ChecksController } from "../lib/useProjectChecks";
import { useContentHash } from "../lib/diagnostics";
import { DiagnosticMessage } from "./ProjectChecks";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  EditProvider,
  type CodeViewHandle,
  type CodeViewProps,
} from "@pierre/diffs/react";
import {
  Editor,
  type EditorFactory,
  type EditorKeymap,
} from "@pierre/diffs/edit";
import type { CodeViewDiffItem, FileDiffMetadata } from "@pierre/diffs";
import {
  Columns2,
  FolderGit2,
  Save,
  Undo2,
  Redo2,
  RotateCw,
  X,
} from "lucide-react";
import type { Pull } from "../../shared/types";
import { api } from "../lib/api";
import { matches, useShortcutLabel } from "../lib/shortcuts";
import { useTheme } from "../lib/useTheme";
import { useSyntaxThemes } from "../lib/appearance";
import { StyledDiffCodeView } from "../vendor/t3code/StyledDiffCodeView";
import { ErrorBox, IconButton, Loading, Modal } from "./ui";
import { useFileDiff } from "../lib/useFileDiff";
import { useLocalFile, type LocalProject } from "../lib/useLocalFile";
import { useSaveShortcut } from "../lib/useSaveShortcut";
import { indentedNewline } from "../lib/newline-indent";
import { checkStatus } from "../lib/editor-checks";
import { useBufferChecks } from "../lib/useBufferChecks";

const keymap: EditorKeymap = [
  {
    bindings: {
      "cmdOrCtrl+d": "copyLineDown",
      "cmdOrCtrl+r": "openSearchReplacePanel",
      "shift+alt+ArrowUp": "moveLineUp",
      "shift+alt+ArrowDown": "moveLineDown",
    },
  },
];
const createEditor: EditorFactory<undefined, undefined> = (type, options) =>
  new Editor(type, {
    ...options,
    historyMaxEntries: 200,
    keymap,
    clipboard: { readText: (type) => (type ? "" : api.readClipboard()) },
  });

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
  const theme = useTheme();
  const syntaxThemes = useSyntaxThemes();
  const file = useLocalFile(project, pull, path, onClose);
  const {
    source,
    error,
    loading,
    needsFolder,
    dirty,
    saving,
    saved,
    confirmation,
    revision,
    buffer: bufferText,
  } = file;
  // Inline, the editor reads like a plain file with change bars; the
  // side-by-side comparison with HEAD is one click away.
  const plain = !!project?.plain;
  const [comparing, setCompare] = useState(
    () => !inline || localStorage.getItem("relay-editor-compare") === "true",
  );
  const compare = comparing && !plain;
  useEffect(() => {
    if (inline) localStorage.setItem("relay-editor-compare", String(comparing));
  }, [inline, comparing]);
  const bufferHash = useContentHash(bufferText);
  const target = pull ?? {
    projectId: project!.id,
    head: { sha: source?.head ?? project!.head },
  };
  const compared = useFileDiff(
    useMemo(
      () =>
        source && {
          editable: true,
          old: {
            name: path,
            contents: source.original,
            cacheKey: `${revision}:${path}`,
          },
          next: {
            name: path,
            contents: source.contents,
            cacheKey: `local:${source.version}`,
          },
          binary: false,
        },
      [source],
    ),
  );
  const diff = compared.diff;
  const blame = useLineBlame(
    target,
    plain
      ? { deletions: undefined, additions: undefined }
      : {
          deletions: {
            revision: revision,
            path,
            label: project ? "HEAD" : "PR head",
          },
          additions: {
            revision: revision,
            path,
            label: "Local checkout",
            ...(source?.original !== bufferText
              ? {
                  unavailable: pull
                    ? "This local version differs from the PR. Hover the PR-head line on the left for committed history."
                    : "This local version differs from HEAD. Hover the HEAD line on the left for committed history.",
                }
              : {}),
          },
        },
    compare ? "split" : "unified",
  );
  const checkState = checks.state;
  const history = (size: number) => (
    <>
      <IconButton
        label="Undo code edit"
        className="editor-history"
        onClick={() => viewer.current?.getEditor(path)?.undo()}
      >
        <Undo2 size={size} />
      </IconButton>
      <IconButton
        label="Redo code edit"
        className="editor-history"
        onClick={() => viewer.current?.getEditor(path)?.redo()}
      >
        <Redo2 size={size} />
      </IconButton>
    </>
  );
  const symbols = useSymbolNavigation(
    target,
    path,
    bufferHash,
    checkState,
    "editing",
  );
  const { problems: fileProblems, markers } = useBufferChecks(
    checks,
    path,
    bufferText,
    bufferHash,
    file.setError,
  );
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const focusedDiff = useRef<FileDiffMetadata | undefined>(undefined);
  useEffect(() => {
    viewer.current?.getEditor(path)?.setMarkers(markers);
  }, [markers, path, diff]);
  const editorOptions = useMemo<
    CodeViewProps<undefined, undefined>["editorOptions"]
  >(
    () => ({
      onAttach: (editor) => {
        editor.setMarkers(markersRef.current);
        if (focusedDiff.current === diff) return;
        focusedDiff.current = diff;
        requestAnimationFrame(() => {
          if (live.current) editor.focus({ lineNumber: line ?? 1 });
        });
      },
    }),
    [diff, line],
  );
  const items = useMemo<CodeViewDiffItem[]>(
    () =>
      diff
        ? [
            {
              id: path,
              type: "diff",
              fileDiff: diff,
              edit: true,
              version: Date.now(),
            },
          ]
        : [],
    [diff],
  );
  const saveKeys = useShortcutLabel("save");
  useSaveShortcut(file.save);
  const large = (source?.contents.split("\n").length ?? 0) > 5000;
  return (
    <EditorFrame
      inline={inline}
      title={`Edit locally · ${path.split("/").pop()}`}
      className="local-editor-modal"
      onClose={file.requestClose}
    >
      {symbols.overlay}
      {inline && (
        <div className="editor-bar">
          <EditorPath path={path} title={source?.path ?? path}>
            <span
              className={`editor-bar-state ${dirty ? "dirty" : ""}`}
              role="status"
            >
              {saving
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : saved
                    ? "Saved"
                    : ""}
            </span>
          </EditorPath>
          {source && symbols.controls}
          <span className="divider" />
          {history(15)}
          <IconButton
            label="Reload local file"
            disabled={saving || loading}
            onClick={file.requestReload}
          >
            <RotateCw size={15} />
          </IconButton>
          {actions}
          {!plain && (
            <IconButton
              label={`Compare with ${project ? "HEAD" : "PR head"}`}
              active={compare}
              onClick={() => setCompare((v) => !v)}
            >
              <Columns2 size={15} />
            </IconButton>
          )}
          <button
            className="primary"
            aria-label="Save locally"
            title={`Save to the local folder${saveKeys && ` (${saveKeys})`}`}
            disabled={!dirty || saving || loading}
            onClick={() => void file.save()}
          >
            Save
          </button>
          <IconButton
            label="Close file"
            disabled={saving}
            onClick={file.requestClose}
          >
            <X size={15} />
          </IconButton>
        </div>
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
      {!!(error || compared.error) && (
        <ErrorBox error={error || compared.error} />
      )}
      {confirmation && (
        <div className="editor-confirmation" role="alert">
          <strong>Keep your unsaved edits?</strong>
          <span>
            {confirmation === "reload"
              ? "Reloading replaces this buffer with the current disk version."
              : "Save to the local folder, or discard this editing session."}
          </span>
          <div>
            <button onClick={file.keepEditing}>Keep editing</button>
            <button
              className="danger subtle"
              disabled={saving}
              onClick={file.discard}
            >
              {confirmation === "close"
                ? "Discard edits"
                : "Reload and discard edits"}
            </button>
            {confirmation === "close" && (
              <button
                className="primary"
                disabled={saving}
                onClick={() => void file.save(true)}
              >
                Save and close
              </button>
            )}
          </div>
        </div>
      )}
      {!source ? (
        <div className="local-editor-empty">
          {loading ? (
            <Loading text="Checking the local checkout…" />
          ) : (
            <>
              {needsFolder && (
                <p>
                  Link this repository to your local checkout to edit its files.
                </p>
              )}
              <button onClick={() => void file.load(true)}>
                <FolderGit2 size={15} />{" "}
                {needsFolder ? "Link local folder" : "Choose another folder"}
              </button>
              {!needsFolder && (
                <button onClick={() => void file.load()}>Retry</button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {checks.enabled && checks.info?.targets.length ? (
            <div className="editor-checks">
              <span>{checkStatus(checkState, path, bufferHash)}</span>
              {fileProblems.length > 0 && (
                <details>
                  <summary>Problems in this file</summary>
                  <div>
                    {fileProblems.map((d, i) => (
                      <button
                        key={i}
                        onClick={() =>
                          viewer.current?.getEditor(path)?.focus({
                            lineNumber: d.line ?? 1,
                            character: (d.column ?? 1) - 1,
                          })
                        }
                      >
                        <small>Line {d.line}</small>
                        <DiagnosticMessage diagnostic={d} />
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ) : null}
          {!inline && symbols.controls}
          {blame.overlay}
          <div className="editor-versions" hidden={!compare}>
            <span>{project ? "HEAD" : "PR head"} · read-only</span>
            <span>Local working tree · editable</span>
          </div>
          <div
            className="local-editor-surface"
            {...blame.handlers}
            inert={loading}
            aria-busy={loading}
            onKeyDownCapture={(event) => {
              const lookup = matches("references", event)
                ? "references"
                : matches("definition", event)
                  ? "definition"
                  : undefined;
              if (lookup) {
                const caret = viewer.current?.getEditor(path)?.getViewState()
                  .selections?.[0]?.start;
                if (caret) {
                  event.preventDefault();
                  event.stopPropagation();
                  symbols.at(caret.line + 1, caret.character + 1, lookup);
                }
                return;
              }
              // Match the current file's indentation when inserting a new line.
              const target = event.nativeEvent.composedPath()[0];
              if (
                event.key !== "Enter" ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                event.shiftKey ||
                event.nativeEvent.isComposing ||
                !(target instanceof HTMLElement) ||
                !target.isContentEditable
              )
                return;
              const editor = viewer.current?.getEditor(path);
              const selections = editor?.getViewState().selections;
              if (!editor || selections?.length !== 1) return;
              const { start, end } = selections[0];
              if (start.line !== end.line || start.character !== end.character)
                return;
              const { text: newText, caret } = indentedNewline(
                editor.getText(),
                start,
              );
              event.preventDefault();
              event.stopPropagation();
              editor.applyEdits([{ range: { start, end }, newText }]);
              editor.setSelections([
                { start: caret, end: caret, direction: "none" },
              ]);
            }}
          >
            {!diff ? (
              <Loading text="Preparing editable diff…" />
            ) : (
              <EditProvider createEditor={createEditor}>
                <StyledDiffCodeView
                  viewerRef={viewer}
                  className="diff-code-view local-edit-code"
                  scrollPastEnd
                  items={items}
                  editorOptions={editorOptions}
                  onItemEditChange={(event) => file.edit(event.file.contents)}
                  onItemEditComplete={() => "reject"}
                  unsafeCSSExtra={`:host {color-scheme:${theme} !important;} [data-diff], [data-file] {opacity:1 !important;} [data-code] {tab-size:2;}`}
                  options={{
                    ...symbols.handlers,
                    useTokenTransformer: true,
                    theme: syntaxThemes,
                    themeType: theme,
                    diffStyle: compare ? "split" : "unified",
                    expandUnchanged: true,
                    disableFileHeader: true,
                    diffIndicators: "bars",
                    overflow: "scroll",
                    lineDiffType: "word-alt",
                    preferredHighlighter: "shiki-js",
                    tokenizeMaxLength: 5000,
                    tokenizeMaxLineLength: 1000,
                    maxLineDiffLength: 1000,
                  }}
                />
              </EditProvider>
            )}
          </div>
          {!inline && (
            <div className="local-editor-footer">
              <span role="status">
                {saving
                  ? "Saving…"
                  : dirty
                    ? "Unsaved changes"
                    : saved
                      ? "Saved to local folder"
                      : "Editing local checkout"}
              </span>
              <span className="editor-shortcuts">
                {saveKeys && `${saveKeys} · `}Save
                {large ? " · Large file, plain text" : ""}
              </span>
              {history(16)}
              <IconButton
                label="Reload local file"
                disabled={saving || loading}
                onClick={file.requestReload}
              >
                <RotateCw size={16} />
              </IconButton>
              <button onClick={file.requestClose} disabled={saving}>
                Done
              </button>
              <button
                className="primary"
                disabled={!dirty || saving || loading}
                onClick={() => void file.save()}
              >
                <Save size={14} /> Save locally
              </button>
            </div>
          )}
          {!inline && (
            <p className="local-editor-note">
              Changes stay in your checkout. Commit and push separately to
              update the PR.
            </p>
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
