import { useSymbolNavigation } from "./SymbolNavigation";
import { useLineBlame } from "./LineBlame";
import type { ChecksController } from "../lib/useProjectChecks";
import { useContentHash } from "../lib/diagnostics";
import { DiagnosticMessage } from "./ProjectChecks";
import { diagnosticSummary, diagnosticSeverity } from "../../shared/checks";
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
  type Marker,
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
import type { LocalFile, Pull } from "../../shared/types";
import { api } from "../lib/api";
import { useTheme } from "../lib/useTheme";
import { useSyntaxThemes } from "../lib/appearance";
import { StyledDiffCodeView } from "../vendor/t3code/StyledDiffCodeView";
import { ErrorBox, IconButton, Loading, Modal } from "./ui";
import DiffWorker from "../lib/diff.worker?worker";

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
  onDirtyChange,
  path,
  line,
  onClose,
}: {
  checks: ChecksController;
  pull?: Pull;
  project?: { id: string; head: string };
  inline?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  path: string;
  line?: number;
  onClose: () => void;
}) {
  const theme = useTheme();
  const syntaxThemes = useSyntaxThemes();
  const [source, setSource] = useState<LocalFile>();
  const [diff, setDiff] = useState<FileDiffMetadata>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [needsFolder, setNeedsFolder] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmation, setConfirmation] = useState<"close" | "reload" | null>(
    null,
  );
  const [bufferText, setBufferText] = useState<string>();
  // Inline, the editor reads like a plain file with change bars; the
  // side-by-side comparison with HEAD is one click away.
  const [compare, setCompare] = useState(
    () => !inline || localStorage.getItem("relay-editor-compare") === "true",
  );
  useEffect(() => {
    if (inline) localStorage.setItem("relay-editor-compare", String(compare));
  }, [inline, compare]);
  const bufferHash = useContentHash(bufferText);
  const target = pull ?? {
    projectId: project!.id,
    head: { sha: source?.head ?? project!.head },
  };
  const revision = pull?.head.sha ?? source?.head ?? project!.head;
  useEffect(
    () => onDirtyChange?.(dirty || saving),
    [dirty, saving, onDirtyChange],
  );
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const blame = useLineBlame(
    target,
    {
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
              unavailable:
                "This local version differs from the PR. Hover the PR-head line on the left for committed history.",
            }
          : {}),
      },
    },
    compare ? "split" : "unified",
  );
  const checkState = checks.state;
  const checked =
    checkState?.status === "ready" &&
    bufferHash &&
    checkState.files[path]?.hash === bufferHash
      ? checkState.files[path]
      : undefined;
  const symbols = useSymbolNavigation(target, path, bufferHash, checkState);
  const fileProblems = useMemo(
    () =>
      checkState?.status === "ready" &&
      bufferHash &&
      checkState.files[path]?.hash === bufferHash
        ? checkState.diagnostics.filter((d) => d.path === path)
        : [],
    [checkState, bufferHash, path],
  );
  const markers = useMemo<Marker[]>(
    () =>
      fileProblems
        .filter((d) => d.line && d.column)
        .sort(
          (a, b) =>
            ({ info: 0, warning: 1, error: 2 })[a.severity] -
            { info: 0, warning: 1, error: 2 }[b.severity],
        )
        .map((d) => ({
          start: { line: d.line! - 1, character: d.column! - 1 },
          end: {
            line: (d.endLine ?? d.line!) - 1,
            character: Math.max((d.endColumn ?? d.column! + 1) - 1, 0),
          },
          severity: d.severity,
          message: d.message,
          source: d.code,
        })),
    [fileProblems],
  );
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const text = useRef("");
  const baseline = useRef("");
  const version = useRef("");
  const savingRef = useRef(false);
  const live = useRef(true);
  const loadGeneration = useRef(0);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const focusedDiff = useRef<FileDiffMetadata | undefined>(undefined);
  useEffect(() => {
    viewer.current?.getEditor(path)?.setMarkers(markers);
  }, [markers, path, diff]);
  useEffect(() => {
    if (bufferText === undefined || !checks.enabled || !checkState?.id) return;
    const timer = setTimeout(() => {
      void checks.buffer(path, bufferText).catch(setError);
    }, 250);
    return () => clearTimeout(timer);
  }, [bufferText, path, checks.enabled, checkState?.id]);
  useEffect(
    () => () => {
      void checks.buffer(path, null).catch(() => {});
    },
    [path, checks.buffer],
  );
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
  const snapshotDirty = () => text.current !== baseline.current;

  const load = async (link = false) => {
    const generation = ++loadGeneration.current;
    const isCurrent = () =>
      live.current && generation === loadGeneration.current;
    setLoading(true);
    setError(undefined);
    try {
      const folder =
        project ||
        (link ? await api.linkFolder(pull!) : await api.folder(pull!));
      if (!isCurrent()) return;
      if (!folder) {
        setNeedsFolder(true);
        return;
      }
      setNeedsFolder(false);
      const file = project
        ? await api.projectFile(project.id, path)
        : await api.readLocalFile(pull!, revision, path);
      if (!isCurrent()) return;
      text.current = baseline.current = file.contents;
      setBufferText(file.contents);
      version.current = file.version;
      setDirty(false);
      setSaved(false);
      setDiff(undefined);
      setSource(file);
    } catch (error) {
      if (isCurrent()) setError(error);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
      loadGeneration.current++;
    };
  }, []);
  useEffect(() => {
    if (!source) return;
    const worker = new DiffWorker();
    const timer = setTimeout(() => {
      worker.terminate();
      setError(
        new Error(
          "This file took too long to compare. Use your IDE for this file.",
        ),
      );
    }, 12000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      if (event.data.error) setError(new Error(event.data.error));
      else setDiff(event.data.value);
      worker.terminate();
    };
    worker.onerror = () => {
      clearTimeout(timer);
      setError(new Error("The editor could not compare this file."));
      worker.terminate();
    };
    worker.postMessage({
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
    });
    return () => {
      clearTimeout(timer);
      worker.terminate();
    };
  }, [source]);
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
  const requestClose = () => {
    if (savingRef.current) return;
    if (snapshotDirty()) setConfirmation("close");
    else onClose();
  };
  const save = async (close = false) => {
    if (!source || !snapshotDirty() || savingRef.current || loading) return;
    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    const contents = text.current;
    try {
      const result = await (project
        ? api.saveProjectFile(
            project.id,
            path,
            source.head,
            version.current,
            contents,
          )
        : api.saveLocalFile(pull!, revision, path, version.current, contents));
      if (!live.current) return;
      version.current = result.version;
      baseline.current = contents;
      setDirty(snapshotDirty());
      setSaved(true);
      setConfirmation(null);
      if (close && !snapshotDirty()) onClose();
    } catch (error) {
      if (live.current) setError(error);
    } finally {
      savingRef.current = false;
      if (live.current) setSaving(false);
    }
  };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!snapshotDirty() && !savingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        void save();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  });
  const large = (source?.contents.split("\n").length ?? 0) > 5000;
  return (
    <EditorFrame
      inline={inline}
      title={`Edit locally · ${path.split("/").pop()}`}
      className="local-editor-modal"
      onClose={requestClose}
    >
      {symbols.overlay}
      {inline && (
        <div className="editor-bar">
          <div className="editor-bar-path" title={source?.path ?? path}>
            {path.includes("/") && (
              <span className="editor-bar-dir">
                <bdi dir="ltr">{path.slice(0, path.lastIndexOf("/") + 1)}</bdi>
              </span>
            )}
            <strong>{path.split("/").pop()}</strong>
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
          </div>
          {source && symbols.controls}
          <span className="divider" />
          <IconButton
            label="Undo code edit"
            onClick={() => viewer.current?.getEditor(path)?.undo()}
          >
            <Undo2 size={15} />
          </IconButton>
          <IconButton
            label="Redo code edit"
            onClick={() => viewer.current?.getEditor(path)?.redo()}
          >
            <Redo2 size={15} />
          </IconButton>
          <IconButton
            label="Reload local file"
            disabled={saving || loading}
            onClick={() =>
              snapshotDirty() ? setConfirmation("reload") : void load()
            }
          >
            <RotateCw size={15} />
          </IconButton>
          <IconButton
            label={`Compare with ${project ? "HEAD" : "PR head"}`}
            active={compare}
            onClick={() => setCompare((v) => !v)}
          >
            <Columns2 size={15} />
          </IconButton>
          <button
            className="primary"
            aria-label="Save locally"
            title="Save to the local folder (⌘/Ctrl S)"
            disabled={!dirty || saving || loading}
            onClick={() => void save()}
          >
            Save
          </button>
          <IconButton
            label="Close file"
            disabled={saving}
            onClick={requestClose}
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
        {source && <small>{source.branch}</small>}
      </div>
      {!!error && <ErrorBox error={error} />}
      {confirmation && (
        <div className="editor-confirmation" role="alert">
          <strong>Keep your unsaved edits?</strong>
          <span>
            {confirmation === "reload"
              ? "Reloading replaces this buffer with the current disk version."
              : "Save to the local folder, or discard this editing session."}
          </span>
          <div>
            <button onClick={() => setConfirmation(null)}>Keep editing</button>
            <button
              className="danger subtle"
              disabled={saving}
              onClick={() => {
                setConfirmation(null);
                if (confirmation === "close") onClose();
                else void load();
              }}
            >
              {confirmation === "close"
                ? "Discard edits"
                : "Reload and discard edits"}
            </button>
            {confirmation === "close" && (
              <button
                className="primary"
                disabled={saving}
                onClick={() => void save(true)}
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
              <button onClick={() => void load(true)}>
                <FolderGit2 size={15} />{" "}
                {needsFolder ? "Link local folder" : "Choose another folder"}
              </button>
              {!needsFolder && (
                <button onClick={() => void load()}>Retry</button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {checks.enabled && checks.info?.targets.length ? (
            <div className="editor-checks">
              <span>
                {checkState?.status === "failed"
                  ? checkState.message
                  : checked && diagnosticSeverity(checked)
                    ? diagnosticSummary(checked)
                    : checkState?.status === "ready" && !checkState.files[path]
                      ? "This file is outside the selected compiler configuration"
                      : checkState?.status === "ready" &&
                          checkState.files[path]?.hash === bufferHash
                        ? "No compiler errors in this file"
                        : "Checking live buffer…"}
              </span>
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
              if (event.key === "F12" || (event.altKey && event.key === "F7")) {
                const caret = viewer.current?.getEditor(path)?.getViewState()
                  .selections?.[0]?.start;
                if (caret) {
                  event.preventDefault();
                  event.stopPropagation();
                  symbols.at(
                    caret.line + 1,
                    caret.character + 1,
                    event.shiftKey || event.key === "F7"
                      ? "references"
                      : "definition",
                  );
                }
                return;
              }
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === "s"
              ) {
                event.preventDefault();
                event.stopPropagation();
                void save();
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
              const lines = editor.getText().split(/\r?\n/);
              const current = lines[start.line] ?? "";
              const indent = current.match(/^[\t ]*/)?.[0] ?? "";
              const unit = lines.some((v) => v.startsWith("\t"))
                ? "\t"
                : " ".repeat(
                    lines.reduce(
                      (width, value) =>
                        Math.min(
                          width,
                          value.match(/^( +)\S/)?.[1].length ?? width,
                        ),
                      4,
                    ),
                  );
              const before = current.slice(0, start.character);
              const after = current.slice(start.character);
              const extra = /[\{\[(]\s*$/.test(before) ? unit : "";
              const eol = editor.getText().includes("\r\n") ? "\r\n" : "\n";
              event.preventDefault();
              event.stopPropagation();
              editor.applyEdits([
                {
                  range: { start, end },
                  newText:
                    eol +
                    indent +
                    extra +
                    (extra && /^\s*[}\])]/.test(after) ? eol + indent : ""),
                },
              ]);
              const caret = {
                line: start.line + 1,
                character: (indent + extra).length,
              };
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
                  items={items}
                  editorOptions={editorOptions}
                  onItemEditChange={(event) => {
                    text.current = event.file.contents;
                    setBufferText(event.file.contents);
                    setDirty(snapshotDirty());
                    setSaved(false);
                  }}
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
                ⌘ / Ctrl S · Save{large ? " · Large file, plain text" : ""}
              </span>
              <IconButton
                label="Undo code edit"
                onClick={() => viewer.current?.getEditor(path)?.undo()}
              >
                <Undo2 size={16} />
              </IconButton>
              <IconButton
                label="Redo code edit"
                onClick={() => viewer.current?.getEditor(path)?.redo()}
              >
                <Redo2 size={16} />
              </IconButton>
              <IconButton
                label="Reload local file"
                disabled={saving || loading}
                onClick={() =>
                  snapshotDirty() ? setConfirmation("reload") : void load()
                }
              >
                <RotateCw size={16} />
              </IconButton>
              <button onClick={requestClose} disabled={saving}>
                Done
              </button>
              <button
                className="primary"
                disabled={!dirty || saving || loading}
                onClick={() => void save()}
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
