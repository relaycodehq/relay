import type { ReactNode } from "react";
import type { DeepReviewStart } from "../../../shared/deep-review";
import type { Project } from "../../../shared/projects";
import { sendsMessage, useSendKey } from "../../lib/send-key";
import { useAgentName } from "./useAgentName";
import { useDeepReviewSetup } from "./useDeepReviewSetup";
import { ProjectBranchPicker } from "../changes/ProjectBranchPicker";
import { ReviewSetups } from "./ReviewSetups";
import { LeadField } from "./LeadField";
import { ReviewersField } from "./ReviewersField";
import { TargetField } from "./TargetField";

/** Replaces the composer in a new deep review thread. */
export function DeepReviewSetup({
  project,
  draftId,
  context,
  branch,
  changes,
  canChoosePR,
  busy,
  checkoutDisabled,
  onStart,
}: {
  project: Project;
  /** The unsent thread, whose composer settings and draft the setup uses. */
  draftId: string;
  /** The thread's context buttons, as the composer shows them. */
  context: ReactNode;
  branch?: string;
  /** Uncommitted files in the checkout. */
  changes: number;
  canChoosePR: boolean;
  busy: boolean;
  checkoutDisabled: boolean;
  /** Resolves true once the review has started. */
  onStart: (config: DeepReviewStart) => Promise<boolean>;
}) {
  const name = useAgentName();
  const sendKey = useSendKey();
  const { setup, update, focus, setFocus, pick, choice, start } =
    useDeepReviewSetup({
      projectId: project.id,
      draftId,
      repository: project.repository,
      branch,
      changes,
      busy,
      onStart,
    });
  const count = setup.reviewers.length;
  return (
    <div className="thread-compose-wrap">
      <div className="thread-context-controls">
        {context}
        <ProjectBranchPicker
          projectId={project.id}
          branch={branch}
          disabled={checkoutDisabled || busy}
        />
      </div>
      <form
        className="project-composer deep-review-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <div className="deep-review-setup">
          <TargetField
            project={project}
            kind={setup.kind}
            pick={pick}
            branch={branch}
            changes={changes}
            canChoosePR={canChoosePR}
            onKind={(kind) => update({ kind })}
          />
          <ReviewersField
            projectId={project.id}
            reviewers={setup.reviewers}
            onChange={(reviewers) => update({ reviewers })}
          />
          <LeadField
            lead={setup.lead}
            runChecks={setup.runChecks}
            onChange={update}
          />
        </div>
        <textarea
          className="composer-prompt-input deep-review-focus"
          aria-label="What to focus on"
          placeholder="Anything to focus on? Optional, e.g. the queue changes, security…"
          value={focus}
          maxLength={4000}
          onChange={(e) => setFocus(e.target.value)}
          onKeyDown={(e) => {
            if (sendsMessage(e, sendKey)) {
              e.preventDefault();
              void start();
            }
          }}
        />
        <div className="composer-tools">
          <ReviewSetups
            setup={choice}
            name={name}
            onLoad={(saved) => update(saved)}
          />
          <span className="spacer" />
          <span className="deep-review-hint">
            {count} {count === 1 ? "reviewer" : "reviewers"} and a lead · runs
            on your plan usage
          </span>
          <button
            type="submit"
            className="primary deep-review-start"
            disabled={!pick.target || busy}
          >
            Start deep review
          </button>
        </div>
      </form>
    </div>
  );
}
