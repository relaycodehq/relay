import { Check, ChevronRight, FileCode2 } from "lucide-react";
import type { AgentProvider } from "../../../shared/agents";
import { agentName } from "../../../shared/agents";
import type { ChangeGroup } from "../../../shared/triage";
import { Modal } from "../../ui/ui";

/** A group's description and files, to look through before marking it viewed. */
export function GroupInspect({
  group,
  provider,
  isRead,
  busy,
  error,
  onOpenFile,
  onReview,
  onClose,
}: {
  group: ChangeGroup;
  /** The agent that grouped the files. */
  provider: AgentProvider;
  isRead: (path: string) => boolean;
  busy: boolean;
  error: string;
  onOpenFile: (path: string) => void;
  onReview: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={group.name} onClose={onClose}>
      <p className="group-description">{group.description}</p>
      <p className="field-note">
        {agentName(provider)} suggests these files contain only this repeated
        change. Inspect any file, then mark the group viewed for this PR
        revision. Files with extra edits stay in Individual changes.
      </p>
      <div className="group-inspect-files">
        {group.paths.map((path) => (
          <button key={path} title={path} onClick={() => onOpenFile(path)}>
            {isRead(path) ? <Check size={14} /> : <FileCode2 size={14} />}
            <span>{path}</span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      {error && (
        <p className="group-error" role="alert">
          {error}
        </p>
      )}
      <div className="group-dialog-actions">
        <span className="muted">
          Saved locally · the review on the host stays unchanged
        </span>
        <button className="primary" disabled={busy} onClick={onReview}>
          {reviewLabel(busy, group.paths.every(isRead), group.paths.length)}
        </button>
      </div>
    </Modal>
  );
}

function reviewLabel(busy: boolean, allRead: boolean, count: number) {
  if (busy) return "Checking…";
  return allRead ? "Mark group unviewed" : `Mark ${count} files viewed`;
}
