import { Wrench } from "lucide-react";
import type { DeepReviewState } from "../../../shared/deep-review";
import type {
  Finding,
  FindingStatus,
  FindingsReport,
} from "../../../shared/findings";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { findingStatus, fixAllLabel } from "./finding-picks";
import { useFindingPicks } from "./useFindingPicks";
import { FindingRow } from "./FindingRow";
import { DroppedFindings } from "./DroppedFindings";
import { reviewerLabel } from "./reviewer-label";
import { useAgentName } from "./useAgentName";

/** An answer's findings, each with its files, to fix all or some of. */
export function FindingsTray({
  chatId,
  report,
  statuses,
  reviewers = [],
  lead,
  busy,
  onFix,
  onStatus,
  onOpenFile,
}: {
  chatId: string;
  report: FindingsReport;
  statuses?: Record<string, FindingStatus>;
  /** A deep review's reviewers, whom each finding names by number. */
  reviewers?: DeepReviewState["reviewers"];
  /** The deep review's lead, who ruled out what's not kept. */
  lead?: DeepReviewState["lead"];
  busy: boolean;
  onFix: (findings: Finding[]) => void;
  onStatus: (id: string, status: "open" | "dismissed") => void;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const { findings, dropped } = report;
  const { open, selected, chosen, toggle, fix } = useFindingPicks(
    findings,
    statuses,
    onFix,
  );
  const name = useAgentName();
  const reviewerLabels = reviewers.map((r, i) =>
    reviewerLabel(r, name(r), i + 1),
  );
  if (!findings.length && !dropped.length) return null;
  return (
    <div className="deep-review-report">
      {findings.length > 0 && (
        <section className="deep-review-tray" aria-label="Findings">
          <ol className="deep-review-tasks">
            {findings.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                status={findingStatus(statuses, f.id)}
                chatId={chatId}
                reviewers={reviewers}
                reviewerLabels={reviewerLabels}
                ticked={selected.includes(f.id)}
                busy={busy}
                onToggle={() => toggle(f.id)}
                onStatus={(status) => onStatus(f.id, status)}
                onOpenFile={onOpenFile}
              />
            ))}
          </ol>
          <footer>
            <span className="spacer" />
            <button
              type="button"
              disabled={!chosen.length || busy}
              onClick={() => fix(chosen)}
            >
              Fix selected{chosen.length ? ` (${chosen.length})` : ""}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!open.length || busy}
              onClick={() => fix(open)}
            >
              <Wrench size={14} />
              {fixAllLabel(open.length, findings.length)}
            </button>
          </footer>
        </section>
      )}
      {dropped.length > 0 && (
        <DroppedFindings
          dropped={dropped}
          reviewers={reviewers}
          reviewerLabels={reviewerLabels}
          lead={lead}
          leadName={lead && name(lead)}
        />
      )}
    </div>
  );
}
