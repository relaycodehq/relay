import { ChevronRight, Wrench } from "lucide-react";
import type { DeepReviewState, Finding } from "../../../shared/deep-review";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { findingStatus, fixAllLabel } from "./finding-picks";
import { useFindingPicks } from "./useFindingPicks";
import { FindingRow } from "./FindingRow";

/** The lead's findings, each with its files, to fix all or some of. */
export function DeepReviewReport({
  chatId,
  state,
  busy,
  onFix,
  onStatus,
  onOpenFile,
}: {
  chatId: string;
  state: DeepReviewState;
  busy: boolean;
  onFix: (findings: Finding[]) => void;
  onStatus: (id: string, status: "open" | "dismissed") => void;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const findings = state.report?.findings ?? [];
  const { open, selected, chosen, toggle, fix } = useFindingPicks(
    findings,
    state.statuses,
    onFix,
  );
  const dropped = state.report?.dropped ?? [];
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
                status={findingStatus(state.statuses, f.id)}
                chatId={chatId}
                reviewers={state.reviewers}
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
        <details className="deep-review-dropped">
          <summary>
            <ChevronRight size={13} /> Not kept · {dropped.length}
          </summary>
          <ul>
            {dropped.map((d, i) => (
              <li key={i}>
                <span className="deep-review-dropped-title">{d.title}</span>
                {d.reason && <span className="muted">{d.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
