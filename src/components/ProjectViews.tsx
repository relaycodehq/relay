import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, FileCode2 } from "lucide-react";
import type { Project } from "../../shared/projects";
import type { ProjectFileLink } from "../../shared/project-file-links";
import { filePathSchema } from "../../shared/validation";
import { api } from "../lib/api";
import { workingTreeKey } from "../lib/working-tree-key";
import type { ChecksController } from "../lib/useProjectChecks";
import { PaneResizer } from "./PaneResizer";
import { LocalChanges } from "./LocalChanges";
import { TurnChanges, type TurnDiffTarget } from "./TurnChanges";
import type { CodeReference } from "../../shared/code-references";
import { ErrorBox, Loading } from "./ui";
import type { PaneSlots } from "./WorkspacePanes";
const LocalFileEditor = lazy(() => import("./LocalFileEditor"));

type Viewing = { path: string | null; viewed: number; total: number };
export type FileTarget = ProjectFileLink & {
  request: number;
  projectId: string;
  /** Lists the files matching this instead of opening one. */
  search?: string;
};

/**
 * Uncommitted work in the folder the thread works in (the checkout, or its
 * worktree), or what one agent turn changed while a turn is open. A changed
 * file clicked in the chat selects its row here; unchanged ones open in the
 * Files pane.
 */
export function ProjectChanges({
  project,
  where,
  slots,
  onViewing,
  onOpenFile,
  onAsk,
  turn,
  onCloseTurn,
  reveal,
  onRevealConsumed,
}: {
  project: Project;
  /** Workspace id: the checkout, or the thread's worktree. */
  where: string;
  slots: PaneSlots;
  onViewing: (v: Viewing) => void;
  onOpenFile: (path: string, line?: number) => void;
  onAsk: (ref: CodeReference) => void;
  turn?: (TurnDiffTarget & { request: number }) | null;
  onCloseTurn: () => void;
  reveal?: FileTarget | null;
  onRevealConsumed: () => void;
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
      reveal={reveal?.projectId === project.id ? reveal : null}
      onRevealConsumed={onRevealConsumed}
    />
  );
}

/** The files of the folder the thread works in, with an inline editor, VS Code style. */
export function ProjectFiles({
  project,
  where,
  checks,
  dirty,
  onDirtyChange,
  onViewing,
  openTarget,
  onOpenTargetConsumed,
}: {
  project: Project;
  /** Workspace id: the checkout, or the thread's worktree. */
  where: string;
  /** Owned by the shell, which shows the status in the title bar. */
  checks: ChecksController;
  dirty: boolean;
  onDirtyChange: (v: boolean) => void;
  onViewing: (v: Viewing) => void;
  openTarget?: FileTarget | null;
  onOpenTargetConsumed?: () => void;
}) {
  // Refreshed by the shell's working-tree poll.
  const tree = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
    enabled: !project.plain,
  });
  // Preserve an edited buffer (and its original revision) if Git moves externally.
  const editorCheckout = useRef(tree.data);
  if (!dirty) editorCheckout.current = tree.data;
  const [file, setFile] = useState<{ path: string; line?: number } | null>(
      () => {
        const path = filePathSchema.safeParse(
          localStorage.getItem("relay-project-file:" + where),
        ).data;
        return path ? { path } : null;
      },
    ),
    [filter, setFilter] = useState("");
  useEffect(() => {
    if (!openTarget || openTarget.projectId !== project.id || dirty) return;
    if (openTarget.search !== undefined || openTarget.directory) {
      setFilter(openTarget.search ?? openTarget.path + "/");
      setFile(null);
    } else {
      setFilter("");
      setFile({ path: openTarget.path, line: openTarget.line });
    }
    onOpenTargetConsumed?.();
  }, [openTarget?.request, project.id, dirty]);
  useEffect(() => {
    if (file) localStorage.setItem("relay-project-file:" + where, file.path);
    else localStorage.removeItem("relay-project-file:" + where);
    onViewing({ path: file?.path ?? null, viewed: 0, total: 0 });
  }, [file?.path, onViewing]);
  const files = useQuery({
    queryKey: ["project-files", where],
    queryFn: () => api.projectFiles(where),
    refetchInterval: 5000,
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
        <div className="project-file-scroll" ref={parent}>
          {files.error && <ErrorBox error={files.error} />}
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((row) => {
              const path = list[row.index];
              const slash = path.lastIndexOf("/");
              return (
                <button
                  key={path}
                  disabled={dirty && path !== file?.path}
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
                  onClick={() => setFile({ path })}
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
      </aside>
      {file && (tree.data || project.plain) ? (
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
            onDirtyChange={onDirtyChange}
            onClose={() => {
              setFile(null);
              onDirtyChange(false);
            }}
          />
        </Suspense>
      ) : (
        <div className="empty project-editor-empty">
          <FileCode2 size={28} />
          <h2>Open a file</h2>
          <p>
            {project.plain
              ? "Pick a file on the left."
              : "Pick a file on the left, or open one from Changes."}
          </p>
          {tree.error && <ErrorBox error={tree.error} />}
        </div>
      )}
    </div>
  );
}
