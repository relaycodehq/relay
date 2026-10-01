import { useMemo } from "react";
import {
  diagnosticSeverity,
  diagnosticSummary,
  type ProjectCheckState,
} from "../../shared/checks";

/**
 * What the project's checks say about one PR file. Its diagnostics belong on
 * the diff only while the checked file is the PR's (`aligned`).
 */
export function useFileChecks(
  checks: ProjectCheckState | null | undefined,
  path: string,
  contentHash: string | undefined,
) {
  const checked = checks?.status === "ready" ? checks.files[path] : undefined;
  const aligned = !!checked && checked.hash === contentHash;
  const diagnostics = useMemo(
    () =>
      checks?.status === "ready"
        ? checks.diagnostics.filter((d) => d.path === path)
        : [],
    [checks, path],
  );
  return { checked, aligned, diagnostics };
}

export type CheckedFile = ProjectCheckState["files"][string];

/** The line above a PR file's diff saying how its checks went. */
export function checkNote(
  status: ProjectCheckState["status"],
  checked: CheckedFile | undefined,
  aligned: boolean,
) {
  if (status === "checking") return "Checking local project…";
  if (status === "failed")
    return "Live checks unavailable — open project checks for details";
  if (!checked)
    return "This file is outside the selected compiler configuration";
  if (!aligned)
    return `Local file differs from PR · ${diagnosticSummary(checked)} in local version`;
  return diagnosticSeverity(checked)
    ? `${diagnosticSummary(checked)} in this file`
    : "No compiler errors in this file";
}
