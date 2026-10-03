import type { Marker } from "@pierre/diffs/edit";
import {
  diagnosticSeverity,
  diagnosticSummary,
  type ProjectCheckState,
  type ProjectDiagnostic,
} from "../../../shared/checks";

type State = ProjectCheckState | null | undefined;

/** The checks' counts for `path`, once they were made from this exact buffer. */
export const checkedFile = (
  state: State,
  path: string,
  hash: string | undefined,
) =>
  state?.status === "ready" && hash && state.files[path]?.hash === hash
    ? state.files[path]
    : undefined;

/** What the bar above the editor says about the checks on this buffer. */
export function checkStatus(
  state: State,
  path: string,
  hash: string | undefined,
) {
  const checked = checkedFile(state, path, hash);
  return state?.status === "failed"
    ? state.message
    : checked && diagnosticSeverity(checked)
      ? diagnosticSummary(checked)
      : state?.status === "ready" && !state.files[path]
        ? "This file is outside the selected compiler configuration"
        : state?.status === "ready" && state.files[path]?.hash === hash
          ? "No compiler errors in this file"
          : "Checking live buffer…";
}

const rank = { info: 0, warning: 1, error: 2 };

/** Squiggles for the problems that have a place, errors last so they win overlaps. */
export const problemMarkers = (problems: ProjectDiagnostic[]): Marker[] =>
  problems
    .filter((d) => d.line && d.column)
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .map((d) => ({
      start: { line: d.line! - 1, character: d.column! - 1 },
      end: {
        line: (d.endLine ?? d.line!) - 1,
        character: Math.max((d.endColumn ?? d.column! + 1) - 1, 0),
      },
      severity: d.severity,
      message: d.message,
      source: d.code,
    }));
