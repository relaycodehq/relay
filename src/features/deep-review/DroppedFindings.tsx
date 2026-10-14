import { ChevronRight, CircleSlash } from "lucide-react";
import type { DeepReviewState, LeadAgent } from "../../../shared/deep-review";
import type { FindingsReport } from "../../../shared/findings";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { FoundBy } from "./FoundBy";
import { traitsName } from "./useAgentName";

/** What the lead looked into and ruled out, who raised it, and why it went. */
export function DroppedFindings({
  dropped,
  reviewers,
  reviewerLabels,
  lead,
  leadName,
}: {
  dropped: FindingsReport["dropped"];
  reviewers: DeepReviewState["reviewers"];
  reviewerLabels: string[];
  lead?: LeadAgent;
  leadName?: string;
}) {
  return (
    <details className="deep-review-dropped">
      <summary>
        <ChevronRight size={13} className="deep-review-dropped-chevron" />
        <span>Not kept · {dropped.length}</span>
        {lead && (
          <span
            className="deep-review-dropped-by"
            title={`Ruled out by the lead\n${leadName} · ${traitsName(lead)}`}
          >
            ruled out by <ProviderIcon provider={lead.provider} />
            {leadName}
          </span>
        )}
      </summary>
      <ol className="deep-review-tray deep-review-tasks">
        {dropped.map((d, i) => (
          <li key={i} className="deep-review-task deep-review-dropped-row">
            <div className="deep-review-task-head">
              <CircleSlash
                size={14}
                className="deep-review-dropped-mark"
                aria-label="Not kept"
              />
              <span className="deep-review-task-title">{d.title}</span>
              <FoundBy
                numbers={d.reviewers}
                reviewers={reviewers}
                labels={reviewerLabels}
                verb="Raised by"
              />
            </div>
            {d.reason && (
              <p className="deep-review-dropped-reason">{d.reason}</p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
