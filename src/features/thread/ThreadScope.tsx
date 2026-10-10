import { ChevronDown, GitPullRequest, ScanSearch, X } from "lucide-react";
import type { ReactNode } from "react";
import type { ChatScope, Project } from "../../../shared/projects";
import type { PullRef } from "../../../shared/types";
import { ProjectHeadlinePicker } from "../projects/ProjectHeadlinePicker";
import { ProjectPullPicker } from "../pulls/ProjectPullPicker";
import { ScratchpadWord } from "./ScratchpadWord";

/** Picking what an empty thread is about: the repository, a PR or a deep review. */
export interface ScopeChoice {
  canChoosePR: boolean;
  /** Back to a plain repository thread, the scope nothing picked means. */
  onClearScope: () => void;
  /**
   * Asks for the Git host first, when PRs can't be chosen yet. Absent when
   * there's no host to ask for: no GitHub remote and no Gitea account.
   */
  onChoosePR?: () => void;
  onSelectPR: (ref: PullRef) => void;
  onDeepReview: () => void;
}

/** What a thread is about, picked beside the composer while it's empty. */
export function ScopeButtons({
  project,
  scope,
  choosing,
  canChoosePR,
  onClearScope,
  onChoosePR,
  onSelectPR,
  onDeepReview,
  onReviewChanges,
  continueSession,
}: ScopeChoice & {
  project: Project;
  scope: ChatScope;
  /** A thread's scope is fixed once it starts; another takes a new thread. */
  choosing: boolean;
  /** A PR thread's way to its diff. */
  onReviewChanges: () => void;
  /** The terminal session picker, offered while choosing. */
  continueSession?: ReactNode;
}) {
  return (
    <>
      {choosing && !project.plain && (
        <>
          <Chosen
            when={scope.kind === "pr"}
            label={scope.kind === "pr" ? `PR #${scope.ref.number}` : ""}
            onClear={onClearScope}
            reserve={
              <>
                <GitPullRequest size={14} />
                Review a PR
                <ChevronDown size={12} />
              </>
            }
          >
            {canChoosePR ? (
              <ProjectPullPicker
                project={project}
                selected={scope.kind === "pr" ? scope.ref : null}
                onSelect={onSelectPR}
                compact
              />
            ) : onChoosePR ? (
              <button
                className={`thread-context-button ${scope.kind === "pr" ? "selected" : ""}`}
                onClick={onChoosePR}
              >
                <GitPullRequest size={14} />
                {scope.kind === "pr"
                  ? `PR #${scope.ref.number}`
                  : "Review a PR"}
                <ChevronDown size={12} />
              </button>
            ) : null}
          </Chosen>
          <Chosen
            when={scope.kind === "review"}
            label="Deep review"
            onClear={onClearScope}
          >
            <button
              className={`thread-context-button ${scope.kind === "review" ? "selected" : ""}`}
              aria-pressed={scope.kind === "review"}
              onClick={scope.kind === "review" ? onClearScope : onDeepReview}
            >
              <ScanSearch size={14} />
              Deep review
            </button>
          </Chosen>
        </>
      )}
      {choosing && !project.scratch && continueSession}
      {scope.kind === "pr" && (
        <button className="thread-review-action" onClick={onReviewChanges}>
          Review changes →
        </button>
      )}
    </>
  );
}

/**
 * A picked scope wears an × that takes the thread back to the repository.
 * With `reserve`, the chip never gets narrower than that unpicked look, so
 * picking and clearing don't slide the controls after it.
 */
function Chosen({
  when,
  label,
  onClear,
  reserve,
  children,
}: {
  when: boolean;
  label: string;
  onClear: () => void;
  reserve?: ReactNode;
  children: ReactNode;
}) {
  const chip = when ? (
    <span className="thread-scope-chosen selected">
      {children}
      <button
        type="button"
        className="thread-scope-clear"
        aria-label={`Clear ${label}`}
        title="Back to a repository thread"
        onClick={onClear}
      >
        <X size={12} aria-hidden />
      </button>
    </span>
  ) : (
    children
  );
  if (!reserve) return chip;
  return (
    <span className="thread-scope-slot">
      <button
        type="button"
        className="thread-scope-ghost"
        tabIndex={-1}
        aria-hidden
      >
        {reserve}
      </button>
      {chip}
    </span>
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
