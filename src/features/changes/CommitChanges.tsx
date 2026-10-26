import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { CommitFileChange } from "../../../shared/history";
import { api } from "../../lib/api";
import { DiffStatLabel } from "./DiffStatLabel";
import { ErrorBox, IconButton, Loading } from "../../ui/ui";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import "./changed-files.css";

/** Which version of a file a commit left, and the parent version it's compared with, as short hashes. */
export type CommitVersion = { sha: string; short: string; parent: string };

/** One commit's message and files; a file picked opens in the editor as the commit left it. */
export function CommitChanges({
  projectId,
  sha,
  onClose,
  onOpenFile,
}: {
  projectId: string;
  sha: string;
  onClose: () => void;
  onOpenFile: (path: string, commit: CommitVersion) => void;
}) {
  // A commit never changes, so what was read stays valid for the session.
  const detail = useQuery({
    queryKey: ["project-commit", projectId, sha],
    queryFn: () => api.projectCommit(projectId, sha),
    staleTime: Infinity,
  });
  const commit = detail.data;
  const parent = commit?.parents[0]?.slice(0, 7);
  const version: CommitVersion = { sha, short: sha.slice(0, 7), parent: parent ?? "empty" };
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
      {detail.error && <ErrorBox error={detail.error} />}
      {!detail.error && !commit && <Loading text="Reading commit…" />}
      {commit && (
        <CommitFiles
          files={commit.files}
          version={version}
          onOpenFile={onOpenFile}
        />
      )}
    </section>
  );
}

/** The files a commit changed; one picked opens as the commit left it. */
function CommitFiles({
  files,
  version,
  onOpenFile,
}: {
  files: CommitFileChange[];
  version: CommitVersion;
  onOpenFile: (path: string, commit: CommitVersion) => void;
}) {
  if (!files.length)
    return <p className="empty">This commit changes no files.</p>;
  return (
    <div className="working-file-list">
      <section aria-label="Changed files">
        <header>
          <strong>
            Changed files <span>{files.length}</span>
          </strong>
        </header>
        {files.map((f) => (
          <div className="working-file" key={f.path}>
            <button
              className="working-select turn-file"
              title={f.previousPath ? `${f.previousPath} → ${f.path}` : f.path}
              onClick={() => onOpenFile(f.path, version)}
            >
              <FileEntryIcon path={f.path} directory={false} />
              <MiddleTruncate text={f.path} kind="path" title={null} />
              {!f.binary && <DiffStatLabel stat={f} />}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
