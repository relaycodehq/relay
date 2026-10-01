import { Plus, X } from "lucide-react";
import {
  MAX_REVIEWERS,
  ownReviewCommand,
  type ReviewAgent,
} from "../../../shared/deep-review";
import { reviewerProviders } from "../../../shared/agents";
import { nextReviewer, swapReviewer } from "../../lib/deep-review-setup";
import { ModelField } from "../ModelField";
import { ReviewPromptLine } from "../ReviewPromptLine";

/** Each reviewer's model and prompt, up to MAX_REVIEWERS. */
export function ReviewersField({
  projectId,
  reviewers,
  onChange,
}: {
  projectId: string;
  reviewers: ReviewAgent[];
  onChange: (reviewers: ReviewAgent[]) => void;
}) {
  const count = reviewers.length;
  return (
    <div className="deep-review-field">
      <span className="deep-review-label">Reviewers</span>
      <div className="deep-review-field-body">
        <ol className="deep-review-reviewers">
          {reviewers.map((reviewer, i) => (
            <li key={i}>
              <span className="deep-review-slot">{i + 1}</span>
              <ModelField
                label={`Reviewer ${i + 1}`}
                provider={reviewer.provider}
                providers={reviewerProviders}
                value={reviewer.choice}
                onChange={(choice, provider) =>
                  onChange(swapReviewer(reviewers, i, choice, provider))
                }
              />
              <ReviewPromptLine
                projectId={projectId}
                provider={reviewer.provider}
                label={`Prompt for reviewer ${i + 1}`}
                value={reviewer.prompt ?? ownReviewCommand(reviewer.provider)}
                onChange={(prompt) =>
                  onChange(
                    reviewers.map((r, j) => (j === i ? { ...r, prompt } : r)),
                  )
                }
              />
              {count > 1 && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove reviewer ${i + 1}`}
                  onClick={() => onChange(reviewers.filter((_, j) => j !== i))}
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ol>
        {count < MAX_REVIEWERS && (
          <button
            type="button"
            className="text-button deep-review-add"
            onClick={() => onChange([...reviewers, nextReviewer(reviewers)])}
          >
            <Plus size={13} /> Add reviewer
          </button>
        )}
      </div>
    </div>
  );
}
