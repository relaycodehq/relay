import {
  ChevronDown,
  FolderGit2,
  GitPullRequest,
  ScanSearch,
} from "lucide-react";
import type { ChatScope, Project } from "../../shared/projects";
import type { PullRef } from "../../shared/types";
import { ProjectHeadlinePicker } from "./ProjectHeadlinePicker";
import { ProjectPullPicker } from "./ProjectPullPicker";
import { ScratchpadWord } from "./ScratchpadWord";

/** Picking what an empty thread is about: the repository, a PR or a deep review. */
export interface ScopeChoice {
  canChoosePR: boolean;
  onRepository: () => void;
  /** Asks for the Git host first, when PRs can't be chosen yet. */
  onChoosePR: () => void;
  onSelectPR: (ref: PullRef) => void;
  onDeepReview: () => void;
}

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
}: ScopeChoice & {
  project: Project;
  scope: ChatScope;
  /** A thread's scope is fixed once it starts; another takes a new thread. */
  choosing: boolean;
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

/** An empty thread's headline: what it's about, in which project. */
export function ThreadIntroduction({
  project,
  projects,
  scope,
  onSwitchProject,
  onAddProject,
}: {
  project: Project;
  projects: Project[];
  scope: ChatScope;
  onSwitchProject: (project: Project) => void;
  onAddProject: () => void;
}) {
  if (project.scratch)
    return (
      <div className="thread-introduction">
        <h1 aria-label="What should we work on in Scratchpad?">
          What should we work on in <ScratchpadWord />?
        </h1>
      </div>
    );
  return (
    <div className="thread-introduction">
      <h1
        aria-label={
          scope.kind === "pr"
            ? `Let’s review PR #${scope.ref.number} in ${project.name}.`
            : scope.kind === "review"
              ? `Deep review of ${project.name}`
              : `What should we work on in ${project.name}?`
        }
      >
        {scope.kind === "pr" ? (
          <>Let’s review PR #{scope.ref.number} in </>
        ) : scope.kind === "review" ? (
          <>Deep review of </>
        ) : (
          <>What should we work on in </>
        )}
        <ProjectHeadlinePicker
          project={project}
          projects={projects}
          onSelect={onSwitchProject}
          onAdd={onAddProject}
        />
        {scope.kind === "pr" ? "." : scope.kind === "review" ? "" : "?"}
      </h1>
      <p>
        {scope.kind === "pr"
          ? "Ask about the changes. Open the review when you’re ready."
          : scope.kind === "review"
            ? "Reviewers read the changes on their own. The lead checks what they found, then fixes it with you."
            : project.plain
              ? "Understand the code or work on an idea."
              : "Understand the code, work on an idea, or review your changes."}
      </p>
    </div>
  );
}
