import type { UseQueryResult } from "@tanstack/react-query";
import { FolderGit2, GitBranch } from "lucide-react";
import type { Draft, LocalFolder, Pull } from "../../../shared/types";
import { ErrorBox, Modal, RichText } from "../../ui/ui";

/** The review's draft comments; one opens its file, drafts from older revisions say so. */
export function DraftsDialog({
  drafts,
  revision,
  onOpen,
  onDelete,
  onClose,
}: {
  drafts: Draft[];
  revision: string;
  onOpen: (draft: Draft) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Your draft comments" onClose={onClose}>
      <p className="muted">
        Drafts stay on this device until you finish your review.
      </p>
      {!drafts.length && (
        <p>No draft comments yet. Select a line in the diff to start one.</p>
      )}
      {drafts.map((d) => (
        <article className="draft-card" key={d.id}>
          <button className="text-button" onClick={() => onOpen(d)}>
            {d.path}:{d.line}
          </button>
          {d.revision !== revision && (
            <span className="warning-note">
              Older revision — copy this feedback and anchor it to the current
              code.
            </span>
          )}
          <RichText text={d.body || "Empty draft"} />
          <button className="text-button danger" onClick={() => onDelete(d.id)}>
            Delete draft
          </button>
        </article>
      ))}
    </Modal>
  );
}

/** The local checkout linked to the PR's repository, and choosing one. */
export function FolderDialog({
  pull,
  folder,
  onLink,
  onClose,
}: {
  pull: Pull;
  folder: UseQueryResult<LocalFolder | null>;
  onLink: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Local repository" onClose={onClose}>
      <p className="muted">
        Link this project to a Git checkout to send line comments to Codex CLI.
      </p>
      {folder.error && <ErrorBox error={folder.error} />}{" "}
      {folder.data ? (
        <div className="folder-info">
          <code>{folder.data.path}</code>
          <p>
            <GitBranch size={14} />
            {folder.data.branch} · {folder.data.head.slice(0, 8)}
          </p>
          <span>
            {folder.data.dirty
              ? "Has uncommitted changes"
              : "Working tree is clean"}
          </span>
          {folder.data.head !== pull.head.sha && (
            <p className="warning-note">
              Check out PR commit {pull.head.sha.slice(0, 8)} before launching
              Codex. Relay never switches branches or overwrites your work.
            </p>
          )}
        </div>
      ) : (
        <p>No folder linked yet.</p>
      )}
      <button className="primary" onClick={onLink}>
        <FolderGit2 size={15} />
        {folder.data ? "Choose another folder" : "Choose repository folder"}
      </button>
    </Modal>
  );
}
