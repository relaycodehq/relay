import type {
  ProjectCheckState,
  ProjectDiagnostic,
} from "../../../shared/checks";
import { checkNote, type CheckedFile } from "../../lib/file-checks";
import { DiagnosticMessage } from "../ProjectChecks";

/**
 * How the project's checks went for a PR file, and its problems while the
 * checked file is the PR's.
 */
export function FileChecks({
  checks,
  checked,
  aligned,
  diagnostics,
  onEditLine,
  onProblem,
}: {
  checks?: ProjectCheckState | null;
  checked?: CheckedFile;
  aligned: boolean;
  diagnostics: ProjectDiagnostic[];
  onEditLine: (line: number) => void;
  onProblem: (line: number) => void;
}) {
  return (
    <>
      {checks && checks.status !== "stopped" && (
        <div
          className={`file-check-status ${checked?.errors ? "has-errors" : ""}`}
        >
          {checkNote(checks.status, checked, aligned)}
          {!!diagnostics.length && !aligned && (
            <button onClick={() => onEditLine(diagnostics[0].line ?? 1)}>
              Inspect local diagnostics
            </button>
          )}
        </div>
      )}
      {aligned && !!diagnostics.length && (
        <details className="review-file-problems">
          <summary>Problems in this file · {diagnostics.length}</summary>
          <div>
            {diagnostics.map((d, i) => (
              <button key={i} onClick={() => onProblem(d.line ?? 1)}>
                <small>Line {d.line}</small>
                <DiagnosticMessage diagnostic={d} />
              </button>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
