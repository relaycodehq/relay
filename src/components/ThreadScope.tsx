import {
  ChevronDown,
  FolderGit2,
  GitPullRequest,
  ScanSearch,
} from "lucide-react";
import type { ChatScope, Project } from "../../shared/projects";
import type { PullRef } from "../../shared/types";
import { ProjectPullPicker } from "./ProjectPullPicker";

/** What a thread is about, picked beside the composer while it's empty. */
export function ScopeButtons({
  project,
  scope,
  choosing,
  canChoosePR,
  onRepository,
  onChoosePR,
  onSelectPR,
  onDeepReview,
  onReviewChanges,
}: {
  project: Project;
  scope: ChatScope;
  /** A thread's scope is fixed once it starts; another takes a new thread. */
  choosing: boolean;
  canChoosePR: boolean;
  onRepository: () => void;
  onChoosePR: () => void;
  onSelectPR: (ref: PullRef) => void;
  onDeepReview: () => void;
  /** A PR thread's way to its diff. */
  onReviewChanges: () => void;
}) {
  return (
    <>
      {choosing && !project.plain && (
        <>
          <button
            className={`thread-context-button ${scope.kind === "project" ? "selected" : ""}`}
            onClick={onRepository}
          >
            <FolderGit2 size={14} />
            Repository
          </button>
          {canChoosePR ? (
            <ProjectPullPicker
              project={project}
              selected={scope.kind === "pr" ? scope.ref : null}
              onSelect={onSelectPR}
              compact
            />
          ) : (
            <button
              className={`thread-context-button ${scope.kind === "pr" ? "selected" : ""}`}
              onClick={onChoosePR}
            >
              <GitPullRequest size={14} />
              {scope.kind === "pr" ? `PR #${scope.ref.number}` : "Review a PR"}
              <ChevronDown size={12} />
            </button>
          )}
          <button
            className={`thread-context-button ${scope.kind === "review" ? "selected" : ""}`}
            onClick={onDeepReview}
          >
            <ScanSearch size={14} />
            Deep review
          </button>
        </>
      )}
      {scope.kind === "pr" && (
        <button className="thread-review-action" onClick={onReviewChanges}>
          Review changes →
        </button>
      )}
    </>
  );
}
