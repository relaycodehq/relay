import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, GitBranch, FileCode2 } from "lucide-react";
import type { Project } from "../../shared/projects";
import type { ProjectFileLink } from "../lib/project-file-links";
import { filePathSchema } from "../../shared/validation";
import type { PullRef } from "../../shared/types";
import { api } from "../lib/api";
import { useProjectChecks } from "../lib/useProjectChecks";
import { ProjectChecksButton } from "./ProjectChecks";
import { LocalChanges } from "./LocalChanges";
import { ErrorBox, IconButton, Loading } from "./ui";
import { ProjectPullPicker } from "./ProjectPullPicker";
const LocalFileEditor = lazy(() => import("./LocalFileEditor"));
export function ProjectPulls({
  project,
  selected,
  onSelect,
  disabled,
  children,
}: {
  project: Project;
  selected: PullRef | null;
  onSelect: (r: PullRef) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="project-pull-picker">
        <ProjectPullPicker
          project={project}
          selected={selected}
          onSelect={onSelect}
          disabled={disabled}
          placement="bottom"
        />
      </div>
      {selected ? (
        children
      ) : (
        <div className="project-pull-empty">
          <p>Select a pull request above to review its changes.</p>
        </div>
      )}
    </>
  );
}
export function ProjectLocal({
  project,
  mode,
  dirty,
  onDirtyChange,
  onViewing,
  openTarget,
  onOpenTargetConsumed,
}: {
  project: Project;
  mode: "changes" | "files";
  dirty: boolean;
  onDirtyChange: (v: boolean) => void;
  onViewing: (v: {
    path: string | null;
    viewed: number;
    total: number;
  }) => void;
  openTarget?:
    (ProjectFileLink & { request: number; projectId: string }) | null;
  onOpenTargetConsumed?: () => void;
}) {
  const tree = useQuery({
    queryKey: ["working-tree", "project", project.id],
    queryFn: () => api.projectWorkingTree(project.id),
    refetchInterval: 3000,
  });
  // Preserve an edited buffer (and its original revision) if Git moves externally.
  const editorCheckout = useRef(tree.data);
  if (!dirty) editorCheckout.current = tree.data;
  const checks = useProjectChecks(
    undefined,
    tree.data ? { id: project.id, head: tree.data.head } : undefined,
  );
  const [file, setFile] = useState<{ path: string; line?: number } | null>(
      () => {
        const path = filePathSchema.safeParse(
          localStorage.getItem("relay-project-file:" + project.id),
        ).data;
        return path ? { path } : null;
      },
    ),
    [filter, setFilter] = useState("");
  useEffect(() => {
    if (
      !openTarget ||
      openTarget.projectId !== project.id ||
      dirty ||
      mode !== "files"
    )
      return;
    if (openTarget.directory) {
      setFilter(openTarget.path + "/");
      setFile(null);
    } else {
      setFilter("");
      setFile({ path: openTarget.path, line: openTarget.line });
    }
    onOpenTargetConsumed?.();
  }, [openTarget?.request, project.id, dirty, mode]);
  useEffect(() => {
    if (file)
      localStorage.setItem("relay-project-file:" + project.id, file.path);
    else localStorage.removeItem("relay-project-file:" + project.id);
    onViewing({ path: file?.path ?? null, viewed: 0, total: 0 });
  }, [file?.path, onViewing]);
  const files = useQuery({
    queryKey: ["project-files", project.id],
    queryFn: () => api.projectFiles(project.id),
    refetchInterval: 5000,
  });
  const list = (files.data ?? []).filter((p) =>
      p.toLowerCase().includes(filter.toLowerCase()),
    ),
    parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: list.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 45,
    overscan: 8,
  });
  return (
    <>
      <div className="project-local-status">
        <GitBranch size={14} />
        <span>{tree.data?.branch || "Local checkout"}</span>
        <span className="spacer" />
        <ProjectChecksButton
          checks={checks}
          onOpenFile={(path, line) => {
            if (!dirty) setFile({ path, line });
          }}
        />
      </div>
      {mode === "changes" ? (
        <LocalChanges
          projectId={project.id}
          onSelection={(path) => onViewing({ path, viewed: 0, total: 0 })}
        />
      ) : (
        <div className="project-file-workspace">
          <aside className="project-file-list">
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
              <div
                style={{ height: virtual.getTotalSize(), position: "relative" }}
              >
                {virtual.getVirtualItems().map((row) => {
                  const path = list[row.index];
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
                      <FileCode2 size={15} />
                      <span>
                        <strong>{path.split("/").pop()}</strong>
                        <small>
                          {path.includes("/")
                            ? path.slice(0, path.lastIndexOf("/"))
                            : "Repository root"}
                        </small>
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
          {file && tree.data ? (
            <Suspense fallback={<Loading text="Opening editor…" />}>
              <LocalFileEditor
                key={`${editorCheckout.current?.head}:${editorCheckout.current?.branch}:${file.path}:${file.line ?? ""}`}
                project={{
                  id: project.id,
                  head: editorCheckout.current?.head ?? tree.data.head,
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
              <FileCode2 size={30} />
              <h2>Open a file</h2>
              <p>
                Edit your working tree with syntax highlighting, live checks and
                symbol navigation.
              </p>
              {tree.error && <ErrorBox error={tree.error} />}
            </div>
          )}
        </div>
      )}
      {mode === "changes" && file && tree.data && (
        <Suspense fallback={<Loading />}>
          <LocalFileEditor
            key={file.path}
            project={{
              id: project.id,
              head: editorCheckout.current?.head ?? tree.data.head,
            }}
            checks={checks}
            {...file}
            onDirtyChange={onDirtyChange}
            onClose={() => setFile(null)}
          />
        </Suspense>
      )}
    </>
  );
}
