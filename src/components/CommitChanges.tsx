import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SquarePen, X } from "lucide-react";
import { api } from "../lib/api";
import { compactCount } from "../lib/turn-diff-tree";
import { PaneResizer } from "./PaneResizer";
import { SplitDiffToggle, useSplitDiff, WorkingDiff } from "./WorkingDiff";
import { ErrorBox, FileEntryIcon, IconButton, Loading } from "./ui";
import "./changed-files.css";

/** One commit's message and files, each diffed against its first parent. */
export function CommitChanges({
  projectId,
  sha,
  onClose,
  onOpenFile,
}: {
  projectId: string;
  sha: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [picked, setPicked] = useState<string>();
  const [split, setSplit] = useSplitDiff();
  // A commit never changes, so what was read stays valid for the session.
  const detail = useQuery({
    queryKey: ["project-commit", projectId, sha],
    queryFn: () => api.projectCommit(projectId, sha),
    staleTime: Infinity,
  });
  const path = picked ?? detail.data?.files[0]?.path;
  const diff = useQuery({
    queryKey: ["project-commit-diff", projectId, sha, path],
    queryFn: () => api.projectCommitDiff(projectId, sha, path!),
    enabled: !!path,
    staleTime: Infinity,
  });
  const commit = detail.data;
  const parent = commit?.parents[0]?.slice(0, 7);
  const sideLabels = {
    deletions: parent ?? "Empty",
    additions: sha.slice(0, 7),
  };
  return (
    <section className="local-changes commit-changes" aria-label="Commit">
      <header className="commit-meta">
        {commit ? (
          <div>
            <strong>{commit.subject}</strong>
            {commit.body && <p>{commit.body}</p>}
            <small>
              <span title={commit.email}>{commit.author}</span> ·{" "}
              {new Date(commit.time * 1000).toLocaleString()} ·{" "}
              <code>{commit.sha.slice(0, 10)}</code>
              {commit.parents.length > 1 && ` · merge, compared with ${parent}`}
            </small>
          </div>
        ) : (
          <div />
        )}
        <IconButton label="Close commit" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </header>
      {detail.error ? (
        <ErrorBox error={detail.error} />
      ) : !commit ? (
        <Loading text="Reading commit…" />
      ) : (
        <div className="working-content">
          <aside className="working-sidebar">
            <PaneResizer
              pane="changes"
              label="Resize changed files"
              initial={250}
              min={200}
              max={600}
            />
            <div className="working-file-list">
              <section>
                <header>
                  <strong>
                    Changed files <span>{commit.files.length}</span>
                  </strong>
                </header>
                {commit.files.map((f) => (
                  <div
                    className={`working-file ${f.path === path ? "selected" : ""}`}
                    key={f.path}
                  >
                    <button
                      className="working-select turn-file"
                      title={
                        f.previousPath
                          ? `${f.previousPath} → ${f.path}`
                          : f.path
                      }
                      onClick={() => setPicked(f.path)}
                    >
                      <FileEntryIcon path={f.path} directory={false} />
                      <span>{f.path}</span>
                      {!f.binary && (
                        <span className="diff-stat">
                          <span className="diff-stat-add">
                            +{compactCount(f.additions)}
                          </span>
                          <span className="diff-stat-del">
                            −{compactCount(f.deletions)}
                          </span>
                        </span>
                      )}
                    </button>
                  </div>
                ))}
              </section>
            </div>
          </aside>
          <div className="working-review">
            {path ? (
              <>
                <header>
                  <strong title={path}>{path}</strong>
                  <span>
                    {sideLabels.deletions} → {sideLabels.additions}
                  </span>
                  <SplitDiffToggle split={split} onChange={setSplit} />
                  <IconButton
                    label="Open in editor"
                    onClick={() => onOpenFile(path)}
                  >
                    <SquarePen size={14} />
                  </IconButton>
                </header>
                {diff.error ? (
                  <ErrorBox error={diff.error} />
                ) : diff.data ? (
                  <WorkingDiff
                    pair={diff.data}
                    sideLabels={sideLabels}
                    split={split}
                  />
                ) : (
                  <Loading text="Loading commit diff…" />
                )}
              </>
            ) : (
              <div className="empty">
                <h2>This commit changed no files.</h2>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
