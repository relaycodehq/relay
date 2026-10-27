import { useState, type ReactNode } from "react";
import {
  MAX_REVIEWERS,
  passCount,
  type DeepReviewStart,
} from "../../../shared/deep-review";
import type { Project } from "../../../shared/projects";
import { sendsMessage, useSendKey } from "../../lib/send-key";
import { useAgentName } from "./useAgentName";
import { useDeepReviewSetup } from "./useDeepReviewSetup";
import { ReviewBranchPicker } from "./ReviewBranchPicker";
import { ReviewSetups } from "./ReviewSetups";
import { LeadField } from "./LeadField";
import { PassesField } from "./passes/PassesField";
import type { ReviewPasses } from "./passes/useReviewPasses";
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
  // The branch checked out elsewhere the review reads in, instead of the project folder.
  const [on, setOn] = useState<string>();
  const review = useDeepReviewSetup({
    projectId: project.id,
    draftId,
    repository: project.repository,
    branch,
    changes,
    on,
    busy,
    onStart,
  });
  const { setup, update, focus, setFocus, pick, passes, runs, choice, start } =
    review;
  const count = setup.reviewers.length;
  return (
    <div className="thread-compose-wrap">
      <div className="thread-context-controls">
        {context}
        <ReviewBranchPicker
          projectId={project.id}
          branch={branch}
          on={on}
          onRead={setOn}
          disabled={busy}
          locked={checkoutDisabled}
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
            branch={review.here.branch}
            changes={review.here.changes}
            canChoosePR={canChoosePR}
            onKind={(kind) => update({ kind })}
          />
          <ReviewersField
            projectId={project.id}
            reviewers={setup.reviewers}
            onChange={(reviewers) => update({ reviewers })}
          />
          <PassesField passes={passes} reviewers={count} />
          <LeadField
            lead={setup.lead}
            runChecks={setup.runChecks}
            onChange={update}
          />
        </div>
        <FocusNote focus={focus} onChange={setFocus} onSend={start} />
        <div className="composer-tools">
          <ReviewSetups
            setup={choice}
            name={name}
            onLoad={(saved) => update(saved)}
          />
          <span className="spacer" />
          <span className="deep-review-hint">{lineup(count, passes)}</span>
          <button
            type="submit"
            className="primary deep-review-start"
            disabled={!pick.target || busy || runs > MAX_REVIEWERS}
          >
            Start deep review
          </button>
        </div>
      </form>
    </div>
  );
}

/** What the reviewers should look at most; the send key starts the review. */
function FocusNote({
  focus,
  onChange,
  onSend,
}: {
  focus: string;
  onChange: (text: string) => void;
  onSend: () => Promise<void>;
}) {
  const sendKey = useSendKey();
  return (
    <textarea
      className="composer-prompt-input deep-review-focus"
      aria-label="What to focus on"
      placeholder="Anything to focus on? Optional, e.g. the queue changes, security…"
      value={focus}
      maxLength={4000}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (sendsMessage(e, sendKey)) {
          e.preventDefault();
          void onSend();
        }
      }}
    />
  );
}

/** "3 reviewers in 4 passes and a lead · runs on your plan usage". */
function lineup(count: number, passes: ReviewPasses) {
  const reviewers = `${count} ${count === 1 ? "reviewer" : "reviewers"}`;
  const split = passes.passes.length ? ` in ${passCount(passes)} passes` : "";
  return `${reviewers}${split} and a lead · runs on your plan usage`;
}
