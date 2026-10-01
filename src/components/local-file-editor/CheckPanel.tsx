import type { ProjectDiagnostic } from "../../../shared/checks";
import { checkStatus } from "../../lib/editor-checks";
import type { FileEditor } from "../../lib/useEditableDiff";
import type { ChecksController } from "../../lib/useProjectChecks";
import { DiagnosticMessage } from "../ProjectChecks";

/** Where the checks stand on the buffer, and its problems to jump to. */
export function CheckPanel({
  checks,
  path,
  hash,
  problems,
  editor,
}: {
  checks: ChecksController;
  path: string;
  hash: string | undefined;
  problems: ProjectDiagnostic[];
  editor: () => FileEditor | undefined;
}) {
  if (!checks.enabled || !checks.info?.targets.length) return null;
  return (
    <div className="editor-checks">
      <span>{checkStatus(checks.state, path, hash)}</span>
      {problems.length > 0 && (
        <details>
          <summary>Problems in this file</summary>
          <div>
            {problems.map((d, i) => (
              <button
                key={i}
                onClick={() =>
                  editor()?.focus({
                    lineNumber: d.line ?? 1,
                    character: (d.column ?? 1) - 1,
                  })
                }
              >
                <small>Line {d.line}</small>
                <DiagnosticMessage diagnostic={d} />
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
