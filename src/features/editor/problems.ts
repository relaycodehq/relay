import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { ProblemMarker } from "../checks/editor-checks";
import { offsetAt } from "./positions";

/** The checks' problems as CodeMirror diagnostics, squiggles under their ranges. */
export function problemDiagnostics(
  doc: Text,
  markers: readonly ProblemMarker[],
): Diagnostic[] {
  return markers.map((m) => {
    const from = offsetAt(doc, m.start.line, m.start.character);
    const to = Math.max(from, offsetAt(doc, m.end.line, m.end.character));
    return {
      from,
      to,
      severity: m.severity,
      message: m.message,
      ...(m.source ? { source: String(m.source) } : {}),
    };
  });
}
