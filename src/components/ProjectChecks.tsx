import { useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  PauseCircle,
  RefreshCw,
} from "lucide-react";
import type { ChecksController } from "../lib/useProjectChecks";
import {
  diagnosticSummary,
  diagnosticSeverity,
  type ProjectDiagnostic,
} from "../../shared/checks";
import { ErrorBox, Modal } from "./ui";
function DiagnosticIcon({
  severity,
}: {
  severity?: ProjectDiagnostic["severity"];
}) {
  const Icon =
    severity === "error"
      ? AlertCircle
      : severity === "warning"
        ? AlertTriangle
        : severity === "info"
          ? Info
          : CheckCircle2;
  return (
    <Icon
      size={16}
      className={`diagnostic-icon ${severity ?? "clean"}`}
      aria-hidden="true"
    />
  );
}
export function DiagnosticMessage({
  diagnostic: d,
}: {
  diagnostic: ProjectDiagnostic;
}) {
  return (
    <span className={`diagnostic-message ${d.severity}`}>
      <strong>
        {d.severity === "info"
          ? "Suggestion"
          : d.severity === "warning"
            ? "Warning"
            : "Error"}{" "}
        · {d.code}
      </strong>{" "}
      {d.message}
    </span>
  );
}
export function ProjectChecksButton({
  checks,
  onOpenFile,
  quiet,
}: {
  checks: ChecksController;
  onOpenFile: (path: string, line?: number) => void;
  /** Hide the button entirely when this project has nothing to check. */
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [filter, setFilter] = useState(""),
    [limit, setLimit] = useState(50);
  const s = checks.state,
    running = s?.status === "checking",
    paused = s?.status === "paused";
  const problems =
    s?.diagnostics.filter(
      (d) =>
        !filter ||
        `${d.path ?? ""} ${d.code} ${d.message}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
    ) ?? [];
  const title =
    checks.error || s?.status === "failed"
      ? "Checks unavailable"
      : !checks.info
        ? "Link folder for live checks"
        : !checks.info.targets.length
          ? "No supported checks"
          : !checks.enabled
            ? "Live checks off"
            : paused
              ? checks.busy
                ? "Checks paused · agent working"
                : "Checks paused"
              : running
                ? "Checking…"
                : s?.status === "ready"
                  ? diagnosticSummary(s)
                  : "Live checks";
  if (quiet && !checks.error && !checks.info?.targets.length && !open)
    return null;
  return (
    <>
      <button
        className={`checks-button ${s?.errors && s.status === "ready" ? "has-errors" : ""}`}
        title={
          paused
            ? "Live checks resume once the agent finishes and the window is visible"
            : "Live diagnostics for the linked local project"
        }
        onClick={() => setOpen(true)}
      >
        {s?.status === "ready" && checks.enabled && !checks.error ? (
          <DiagnosticIcon severity={diagnosticSeverity(s)} />
        ) : paused ? (
          <PauseCircle size={15} />
        ) : (
          <Activity size={15} />
        )}
        <span>{title}</span>
      </button>
      {open && (
        <Modal
          title="Live project checks"
          className="project-checks-modal"
          onClose={() => setOpen(false)}
        >
          <p className="field-note">
            Diagnostics appear while reviewing and update as you type. Checks
            use the linked working tree and unsaved editor buffer. Only matching
            file contents get inline diagnostics in the PR. Rechecking pauses
            while an agent is working or the window is hidden, then runs once.
          </p>
          {!!checks.error && <ErrorBox error={checks.error} />}
          {!checks.info ? (
            <p>
              Link this PR to its local folder first. Install the project’s
              dependencies there; live checks use its own compiler version.
            </p>
          ) : (
            <>
              <div className="checks-settings">
                <strong>{checks.info.framework}</strong>
                <label>
                  <input
                    type="checkbox"
                    checked={checks.enabled}
                    disabled={!checks.info.targets.length}
                    onChange={(e) => checks.toggle(e.target.checked)}
                  />{" "}
                  Live checks
                </label>
              </div>
              {checks.info.targets.length > 0 && (
                <label className="field">
                  Check configuration
                  <select
                    aria-label="Check configuration"
                    value={checks.target?.id}
                    onChange={(e) => checks.choose(e.target.value)}
                  >
                    {checks.info.targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} · {t.config}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="field-note">
                {checks.info.note ??
                  "Angular TypeScript, template and compiler diagnostics. Uses your strictness settings; this does not bundle assets or run build scripts."}
              </p>
              {s?.message && <p className="checks-notice">{s.message}</p>}
              <div className="checks-summary" aria-live="polite">
                {s?.status === "ready" && checks.enabled && !checks.error ? (
                  <DiagnosticIcon severity={diagnosticSeverity(s)} />
                ) : (
                  <Activity size={17} />
                )}
                <strong>{title}</strong>
                <button
                  disabled={!checks.enabled || !checks.target || paused}
                  onClick={checks.restart}
                >
                  <RefreshCw size={13} /> Recheck
                </button>
              </div>
              {s?.status === "ready" && (
                <>
                  {s.suggestions > 0 && (
                    <p className="field-note checks-suggestions-note">
                      Suggestions flag things like unused code and deprecated
                      APIs. They do not block compilation with this
                      configuration.
                    </p>
                  )}
                  <input
                    aria-label="Filter diagnostics"
                    placeholder="Filter files, diagnostic codes or messages…"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setLimit(50);
                    }}
                  />
                  <div className="project-problems">
                    {problems.slice(0, limit).map((d, i) => (
                      <button
                        key={i}
                        disabled={!d.path}
                        className={`project-problem ${d.severity}`}
                        onClick={() => {
                          if (d.path) {
                            setOpen(false);
                            onOpenFile(d.path, d.line);
                          }
                        }}
                      >
                        <DiagnosticIcon severity={d.severity} />
                        <span>
                          <small>
                            {d.path ?? checks.target?.config}
                            {d.line ? `:${d.line}:${d.column}` : ""}
                          </small>
                          <DiagnosticMessage diagnostic={d} />
                        </span>
                      </button>
                    ))}
                    {problems.length > limit && (
                      <button onClick={() => setLimit((n) => n + 50)}>
                        Show more problems
                      </button>
                    )}
                    {!problems.length && (
                      <p className="field-note">
                        {filter
                          ? "No matching problems."
                          : "No errors, warnings or suggestions in this configuration."}
                      </p>
                    )}
                  </div>
                  {s.truncated && (
                    <p className="field-note">
                      Showing the first 1,500 diagnostics, with errors and
                      warnings first. Totals include all diagnostics.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
