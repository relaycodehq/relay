import type { EditorView } from "@codemirror/view";
import { checksCover, type ProjectDiagnostic } from "../../../shared/checks";
import { checkStatus } from "../checks/editor-checks";
import { DiagnosticMessage } from "../checks/ProjectChecks";
import type { ChecksController } from "../checks/useProjectChecks";
import { moveCaretTo } from "./caret";

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
  editor: () => EditorView | undefined;
}) {
  const checksApply =
    checks.enabled && !!checks.info?.targets.length && checksCover(checks.target, path);
  if (!checksApply) return null;
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
                onClick={() => {
                  const view = editor();
                  if (!view) return;
                  moveCaretTo(view, d.line ?? 1, d.column ?? 1);
                  view.focus();
                }}
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
