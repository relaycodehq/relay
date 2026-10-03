import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../../lib/api";
import { DiffStatLabel } from "./DiffStatLabel";
import { ChangesReview, ChangesSidebar } from "./ChangesPane";
import { ErrorBox, FileEntryIcon, IconButton, Loading } from "../../ui/ui";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
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
          <ChangesSidebar title="Changed files" count={commit.files.length}>
            {commit.files.map((f) => (
              <div
                className={`working-file ${f.path === path ? "selected" : ""}`}
                key={f.path}
              >
                <button
                  className="working-select turn-file"
                  title={
                    f.previousPath ? `${f.previousPath} → ${f.path}` : f.path
                  }
                  onClick={() => setPicked(f.path)}
                >
                  <FileEntryIcon path={f.path} directory={false} />
                  <MiddleTruncate text={f.path} kind="path" title={null} />
                  {!f.binary && <DiffStatLabel stat={f} />}
                </button>
              </div>
            ))}
          </ChangesSidebar>
          <ChangesReview
            path={path}
            sides={sideLabels}
            diff={diff}
            loading="Loading commit diff…"
            empty="This commit changed no files."
            onOpenFile={onOpenFile}
          />
        </div>
      )}
    </section>
  );
}
