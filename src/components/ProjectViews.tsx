import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, FileCode2 } from "lucide-react";
import type { Project } from "../../shared/projects";
import type { ProjectFileLink } from "../../shared/project-file-links";
import { filePathSchema } from "../../shared/validation";
import { api } from "../lib/api";
import { workingTreeKey } from "../lib/working-tree-key";
import type { TurnDiffTarget } from "../lib/turn-diff";
import type { FileTarget } from "../lib/file-link-target";
import { useNavigationLock } from "../lib/navigation-lock";
import { useRequests, type RequestChannel } from "../lib/request-channel";
import type { ChecksController } from "../lib/useProjectChecks";
import { ancestors } from "../lib/file-tree";
import { useExpanded } from "../lib/useFileTree";
import { FileTree } from "./FileTree";
import { FolderView, ImageFile, OtherFile, RevealButtons } from "./FileViews";
import { PaneResizer } from "./PaneResizer";
import { LocalChanges } from "./LocalChanges";
import { TurnChanges } from "./TurnChanges";
import type { CodeReference } from "../../shared/code-references";
import { ErrorBox, Loading } from "./ui";
import type { PaneSlots } from "./WorkspacePanes";
const LocalFileEditor = lazy(() => import("./LocalFileEditor"));

type Viewing = { path: string | null; viewed: number; total: number };

/**
 * Uncommitted work in the folder the thread works in (the checkout, or its
 * worktree), or what one agent turn changed while a turn is open. A changed
 * file clicked in the chat selects its row here; unchanged ones open in the
 * Files pane.
 */
export function ProjectChanges({
  where,
  slots,
  onViewing,
  onOpenFile,
  onAsk,
  turn,
  onCloseTurn,
  reveals,
}: {
  /** Workspace id: the checkout, or the thread's worktree. */
  where: string;
  slots: PaneSlots;
  onViewing: (v: Viewing) => void;
  onOpenFile: (path: string, line?: number) => void;
  onAsk: (ref: CodeReference) => void;
  turn?: (TurnDiffTarget & { request: number }) | null;
  onCloseTurn: () => void;
  reveals: RequestChannel<ProjectFileLink>;
}) {
  if (turn)
    return (
      <TurnChanges
        key={turn.request}
        target={turn}
        slots={slots}
        onClose={onCloseTurn}
        onOpenFile={onOpenFile}
      />
    );
  return (
    <LocalChanges
      projectId={where}
      slots={slots}
      onOpenFile={onOpenFile}
      onAsk={onAsk}
      onSelection={(path) => onViewing({ path, viewed: 0, total: 0 })}
      reveals={reveals}
    />
  );
}

type Selection =
  { kind: "file"; path: string; line?: number } | { kind: "dir"; path: string };

/**
 * The folder the thread works in: a tree read straight from disk (ignored
 * files included), folder and picture views, and an inline editor for text.
 */
export function ProjectFiles({
  project,
  where,
  checks,
  onViewing,
  opens,
}: {
  project: Project;
  /** Workspace id: the checkout, or the thread's worktree. */
  where: string;
  /** Owned by the shell, which shows the status in the title bar. */
  checks: ChecksController;
  onViewing: (v: Viewing) => void;
  /** Files to open, such as ones clicked in the chat. */
  opens?: RequestChannel<FileTarget>;
}) {
  // Refreshed by the shell's working-tree poll.
  const tree = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
    enabled: !project.plain,
  });
  // Preserve an edited buffer (and its original revision) if Git moves externally.
  const { locked } = useNavigationLock();
  const editorCheckout = useRef(tree.data);
  if (!locked) editorCheckout.current = tree.data;
  const expansion = useExpanded(where);
  const [selection, setSelection] = useState<Selection | null>(() => {
      const path = filePathSchema.safeParse(
        localStorage.getItem("relay-project-file:" + where),
      ).data;
      return path ? { kind: "file", path } : null;
    }),
    [filter, setFilter] = useState("");
  const file = selection?.kind === "file" ? selection : null;
  const select = (next: Selection | null) => {
    if (next) expansion.expand(ancestors(next.path));
    setSelection(next);
  };
  useRequests(opens, (target) => {
    if (target.search !== undefined) {
      setFilter(target.search);
      setSelection(null);
    } else {
      setFilter("");
      if (target.directory) {
        expansion.expand([...ancestors(target.path), target.path]);
        setSelection({ kind: "dir", path: target.path });
      } else select({ kind: "file", path: target.path, line: target.line });
    }
  });
  useEffect(() => {
    if (file) localStorage.setItem("relay-project-file:" + where, file.path);
    else localStorage.removeItem("relay-project-file:" + where);
    onViewing({ path: file?.path ?? null, viewed: 0, total: 0 });
  }, [file?.path, onViewing]);
  // What kind of file it is decides the viewer; a picture rewritten on disk redraws.
  const info = useQuery({
    queryKey: ["project-file-info", where, file?.path],
    queryFn: () => api.projectFileInfo(where, file!.path),
    enabled: !!file,
    retry: false,
    refetchInterval: (q) => (q.state.data?.kind === "text" ? false : 3000),
  });
  const files = useQuery({
    queryKey: ["project-files", where],
    queryFn: () => api.projectFiles(where),
    refetchInterval: 5000,
    enabled: !!filter,
  });
  const list = (files.data ?? []).filter((p) =>
      p.toLowerCase().includes(filter.toLowerCase()),
    ),
    parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: list.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 28,
    overscan: 12,
  });
  const [actionError, setActionError] = useState<unknown>();
  const editorReady = !!file && (tree.data || project.plain);
  return (
    <div className="files-workspace">
      <aside className="project-file-list">
        <PaneResizer
          pane="files"
          label="Resize file list"
          initial={210}
          min={160}
          max={600}
        />
        <div className="search-field">
          <Search size={14} />
          <input
            aria-label="Find project file"
            placeholder="Find file…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {filter ? (
          <div className="project-file-scroll" ref={parent}>
            {files.error && <ErrorBox error={files.error} />}
            <div
              style={{ height: virtual.getTotalSize(), position: "relative" }}
            >
              {virtual.getVirtualItems().map((row) => {
                const path = list[row.index];
                const slash = path.lastIndexOf("/");
                return (
                  <button
                    key={path}
                    disabled={locked && path !== file?.path}
                    className={path === file?.path ? "selected" : ""}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: row.size,
                      transform: `translateY(${row.start}px)`,
                    }}
                    title={path}
                    onClick={() => select({ kind: "file", path })}
                  >
                    <FileCode2 size={14} />
                    <span>
                      <strong>{path.slice(slash + 1)}</strong>
                      {slash > 0 && <small>{path.slice(0, slash)}</small>}
                    </span>
                    {checks.state?.files[path]?.errors ? (
                      <b className="file-errors">
                        {checks.state.files[path].errors}
                      </b>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <FileTree
            where={where}
            title={project.name}
            selected={selection?.path ?? null}
            lockedPath={locked && file ? file.path : null}
            expansion={expansion}
            onSelect={(path, kind) => select({ kind, path })}
            onCreated={(path, kind) => select({ kind, path })}
            onMoved={(from, to) => {
              expansion.remap(from, to);
              if (
                selection &&
                (selection.path === from ||
                  selection.path.startsWith(from + "/"))
              )
                select({
                  ...selection,
                  path: to + selection.path.slice(from.length),
                });
            }}
            onTrashed={(path) => {
              expansion.remap(path, null);
              if (
                selection &&
                (selection.path === path ||
                  selection.path.startsWith(path + "/"))
              )
                setSelection(null);
            }}
          />
        )}
      </aside>
      {file ? (
        info.error ? (
          <div className="empty project-editor-empty">
            <FileCode2 size={28} />
            <h2>Can’t open this file</h2>
            <ErrorBox error={info.error} />
          </div>
        ) : !info.data ? (
          <Loading text="Opening…" />
        ) : info.data.kind === "image" ? (
          <ImageFile where={where} info={info.data} />
        ) : info.data.kind === "other" ? (
          <OtherFile where={where} info={info.data} />
        ) : editorReady ? (
          <div className="files-main">
            {!!actionError && <ErrorBox error={actionError} />}
            <Suspense fallback={<Loading text="Opening editor…" />}>
              <LocalFileEditor
                key={`${editorCheckout.current?.head}:${editorCheckout.current?.branch}:${file.path}:${file.line ?? ""}`}
                project={{
                  id: where,
                  head: editorCheckout.current?.head ?? tree.data?.head ?? "",
                  plain: project.plain,
                }}
                checks={checks}
                path={file.path}
                line={file.line}
                inline
                actions={
                  <RevealButtons
                    where={where}
                    path={file.path}
                    external
                    onError={setActionError}
                  />
                }
                onClose={() => setSelection(null)}
              />
            </Suspense>
          </div>
        ) : (
          <Loading text="Opening editor…" />
        )
      ) : (
        <FolderView
          key={selection?.path ?? ""}
          where={where}
          dir={selection?.path ?? ""}
          title={project.name}
          onOpen={(path, kind) => select({ kind, path })}
        />
      )}
    </div>
  );
}
