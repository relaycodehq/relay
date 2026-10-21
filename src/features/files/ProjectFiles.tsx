import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, FileCode2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Project } from "../../../shared/projects";
import { filePathSchema } from "../../../shared/validation";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import type { FileTarget } from "./file-link-target";
import { useNavigationLock } from "../../lib/navigation-lock";
import { useRequests, type RequestChannel } from "../../lib/request-channel";
import type { ChecksController } from "../checks/useProjectChecks";
import { ancestors } from "../../lib/file-tree";
import { useExpanded } from "./useFileTree";
import type { Viewing } from "../thread/useThreadView";
import { FileTree } from "./FileTree";
import { OutsideFile } from "./OutsideFile";
import { FileViewer } from "./FileViewer";
import { PaneResizer } from "../../ui/PaneResizer";
import { ErrorBox, IconButton } from "../../ui/ui";
import { useStoredFlag } from "../../lib/useStoredFlag";
import { usePoll } from "../../lib/poll";

type Selection =
  | { kind: "file"; path: string; line?: number }
  | { kind: "dir"; path: string }
  /** A file outside the project, by its absolute path. */
  | { kind: "outside"; path: string; line?: number };

/**
 * The folder the thread works in: a tree read straight from disk (ignored
 * files included), folder and picture views, and an inline editor for text.
 */
export function ProjectFiles({
  active,
  project,
  where,
  watched,
  checks,
  onViewing,
  opens,
}: {
  /** The Files tab is in front; hidden editors stay mounted without polling. */
  active: boolean;
  project: Project;
  /** Workspace id: the checkout, or the thread's worktree. */
  where: string;
  /** The shell refreshes its listings when the folder changes. */
  watched: boolean;
  /** Owned by the shell, which shows the status in the title bar. */
  checks: ChecksController;
  onViewing: (v: Viewing) => void;
  /** Files to open, such as ones clicked in the chat. */
  opens?: RequestChannel<FileTarget>;
}) {
  const poll = usePoll();
  // Refreshed by the shell's working-tree poll.
  const tree = useQuery({
    queryKey: workingTreeKey(where),
    queryFn: () => api.projectWorkingTree(where),
    enabled: !project.plain,
  });
  // Preserve an edited buffer (and its original revision) if Git moves externally.
  const { locked, blocked } = useNavigationLock();
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
  const [listHidden, setListHidden] = useStoredFlag("relay-file-list-hidden");
  useRequests(opens, (target) => {
    if (target.outside)
      setSelection({ kind: "outside", path: target.path, line: target.line });
    else if (target.search !== undefined) {
      setFilter(target.search);
      setSelection(null);
    } else {
      setFilter("");
      if (target.directory) {
        expansion.expand([...ancestors(target.path), target.path]);
        setSelection({ kind: "dir", path: target.path });
        setListHidden(false);
      } else select({ kind: "file", path: target.path, line: target.line });
    }
  });
  useEffect(() => {
    if (file) localStorage.setItem("relay-project-file:" + where, file.path);
    else localStorage.removeItem("relay-project-file:" + where);
    onViewing({ path: file?.path ?? null, viewed: 0, total: 0 });
  }, [file?.path, onViewing]);
  const files = useQuery({
    queryKey: ["project-files", where],
    queryFn: () => api.projectFiles(where),
    refetchInterval: poll(5000),
    enabled: active && !listHidden && !!filter,
    staleTime: 0,
  });
  const list = (files.data ?? []).filter((p) =>
      p.toLowerCase().includes(filter.toLowerCase()),
    ),
    parent = useRef<HTMLDivElement>(null),
    findInput = useRef<HTMLInputElement>(null);
  const virtual = useVirtualizer({
    count: list.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 28,
    overscan: 12,
  });
  const editorReady = !!file && (tree.data || project.plain);
  const listToggle = (
    <IconButton
      label={listHidden ? "Show file list" : "Hide file list"}
      className="file-list-toggle"
      onClick={() => setListHidden((hidden) => !hidden)}
    >
      {listHidden ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
    </IconButton>
  );
  return (
    <div className="files-workspace">
      <aside className="project-file-list" hidden={listHidden}>
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
            ref={findInput}
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
            active={active && !listHidden}
            where={where}
            watched={watched}
            title={project.name}
            selected={selection?.path ?? null}
            lockedPath={
              locked && selection?.kind !== "dir"
                ? (selection?.path ?? null)
                : null
            }
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
      {selection?.kind === "outside" ? (
        <OutsideFile
          active={active}
          path={selection.path}
          line={selection.line}
          checks={checks}
          lead={listToggle}
          onOpen={(path) => {
            if (!blocked()) setSelection({ kind: "outside", path });
          }}
          onClose={() => setSelection(null)}
        />
      ) : file ? (
        <FileViewer
          active={active}
          where={where}
          path={file.path}
          lead={listToggle}
          editorKey={`${editorCheckout.current?.head}:${editorCheckout.current?.branch}:${file.path}:${file.line ?? ""}`}
          editor={
            editorReady
              ? {
                  project: {
                    id: where,
                    head: editorCheckout.current?.head ?? tree.data?.head ?? "",
                    plain: project.plain,
                  },
                  checks,
                  line: file.line,
                  stamp: tree.data?.revision,
                  onOpenLink: (target) => {
                    if (blocked()) return;
                    if (!target.directory)
                      return select({ kind: "file", path: target.path });
                    expansion.expand([...ancestors(target.path), target.path]);
                    setSelection({ kind: "dir", path: target.path });
                    setListHidden(false);
                  },
                  onClose: () => setSelection(null),
                }
              : undefined
          }
        />
      ) : (
        // Folders are browsed in the tree; this side only shows files.
        <div className="files-main">
          <div className="editor-bar">{listToggle}</div>
          <div className="empty project-editor-empty">
            <FileCode2 size={28} />
            <h2>No file open</h2>
            <p>Pick one from the list, or find it by name.</p>
            <button
              onClick={() => {
                setListHidden(false);
                requestAnimationFrame(() => findInput.current?.focus());
              }}
            >
              <Search size={14} /> Find a file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
