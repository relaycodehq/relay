import type { ReactNode } from "react";
import type { DeepReviewStart } from "../../../shared/deep-review";
import type { Project } from "../../../shared/projects";
import { agentProviders } from "../../../shared/agents";
import { sendsMessage, useSendKey } from "../../lib/send-key";
import { useAgentName } from "./useAgentName";
import { useDeepReviewSetup } from "./useDeepReviewSetup";
import { ModelField } from "../agents/ModelField";
import { ProjectBranchPicker } from "../changes/ProjectBranchPicker";
import { ReviewSetups } from "./ReviewSetups";
import { ReviewersField } from "./ReviewersField";
import { TargetField } from "./TargetField";

/** Replaces the composer in a new deep review thread. */
export function DeepReviewSetup({
  project,
  settingsKey,
  context,
  branch,
  changes,
  canChoosePR,
  busy,
  checkoutDisabled,
  onStart,
}: {
  project: Project;
  /** The unsent thread's composer settings. */
  settingsKey: string;
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
      settingsKey,
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
            onBase={(base) => update({ base })}
          />
          <ReviewersField
            projectId={project.id}
            reviewers={setup.reviewers}
            onChange={(reviewers) => update({ reviewers })}
          />
          <div className="deep-review-field">
            <span className="deep-review-label">Lead</span>
            <div className="deep-review-field-body deep-review-lead">
              <ModelField
                label="Lead"
                provider={setup.lead.provider}
                providers={agentProviders}
                value={setup.lead.choice}
                onChange={(choice, provider) =>
                  update({ lead: { provider, choice } })
                }
              />
              <span className="deep-review-note">
                Merges and verifies the findings, then fixes them with you.
              </span>
              <label className="deep-review-check">
                <input
                  type="checkbox"
                  checked={setup.runChecks}
                  onChange={(e) => update({ runChecks: e.target.checked })}
                />
                Can run tests to verify
              </label>
            </div>
          </div>
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
