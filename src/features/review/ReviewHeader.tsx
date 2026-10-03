import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitPullRequest,
} from "lucide-react";
import type { Pull } from "../../../shared/types";
import { api } from "../../lib/api";
import type { ChecksController } from "../checks/useProjectChecks";
import { ProjectChecksButton } from "../checks/ProjectChecks";
import { IconButton } from "../../ui/ui";
import { timeAgo } from "../../lib/relative-date";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import type { PaneSlots } from "../../ui/WorkspacePanes";

interface Actions {
  pull: Pull;
  paneControls: ReactNode;
  checks: ChecksController;
  /** Drafts with something written, which Finish review publishes. */
  draftCount: number;
  /** Progress has loaded, so the review can be finished. */
  ready: boolean;
  onEditFile: (path: string, line?: number) => void;
  onFinish: () => void;
  onError: (e: unknown) => void;
}

/**
 * The PR under review and its actions: in a workspace pane they move into
 * the pane's header; otherwise a titlebar sits above the PR's heading.
 */
export function ReviewHeader({
  slots,
  ...actions
}: Actions & { slots?: PaneSlots }) {
  const { pull } = actions;
  if (slots)
    return (
      <>
        {slots.title &&
          createPortal(
            <span className="pane-subtitle" title={pull.title}>
              #{pull.number} · {pull.title}
            </span>,
            slots.title,
          )}
        {slots.actions &&
          createPortal(
            <ReviewActions {...actions} quiet iconSize={16} />,
            slots.actions,
          )}
      </>
    );
  return (
    <>
      <header className="titlebar review-titlebar">
        <div className="breadcrumb">
          <span>{pull.owner}</span>
          <ChevronRight size={13} />
          <strong>{pull.name}</strong>
          <span className="pr-number">#{pull.number}</span>
        </div>
        <div className="toolbar-actions">
          <ReviewActions {...actions} iconSize={18} />
        </div>
      </header>
      <PullHeading pull={pull} />
    </>
  );
}

function ReviewActions({
  pull,
  paneControls,
  checks,
  draftCount,
  ready,
  onEditFile,
  onFinish,
  onError,
  quiet,
  iconSize,
}: Actions & { quiet?: boolean; iconSize: number }) {
  return (
    <>
      {paneControls}
      <ProjectChecksButton
        quiet={quiet}
        checks={checks}
        onOpenFile={onEditFile}
      />
      <IconButton
        label="Open pull request in Gitea"
        onClick={() => void api.openExternal(pull.html_url).catch(onError)}
      >
        <ArrowUpRight size={iconSize} />
      </IconButton>
      <button
        className="primary review-button"
        onClick={onFinish}
        disabled={!ready}
      >
        Finish review{draftCount > 0 && <span>{draftCount}</span>}
        <ChevronDown size={13} />
      </button>
    </>
  );
}

function PullHeading({ pull }: { pull: Pull }) {
  return (
    <section className="pr-heading">
      <div className="pr-heading-top">
        <span className={`state-badge ${pull.state}`}>
          <GitPullRequest size={13} />
          {pull.merged
            ? "Merged"
            : pull.draft
              ? "Draft"
              : pull.state === "open"
                ? "Open"
                : "Closed"}
        </span>
        <span className="muted">
          #{pull.number} opened by <strong>{pull.user.login}</strong>
        </span>
      </div>
      <h1>{pull.title}</h1>
      <div className="branch-line">
        <GitBranch size={14} />
        <code>
          <MiddleTruncate text={pull.head.ref} kind="branch" />
        </code>
        <span>→</span>
        <code>
          <MiddleTruncate text={pull.base.ref} kind="branch" />
        </code>
        <span className="branch-divider" />
        <span className="additions">+{pull.additions ?? 0}</span>
        <span className="deletions">−{pull.deletions ?? 0}</span>
        <span className="push-date">Updated {timeAgo(pull.updated_at)}</span>
      </div>
    </section>
  );
}
