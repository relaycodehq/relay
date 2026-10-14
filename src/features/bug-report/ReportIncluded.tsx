import { useState } from "react";
import type {
  BugReportFact,
  BugReportFields,
  BugReportPreview,
} from "../../../shared/bug-report";

/**
 * VS Code's "Include my system information (show)" rows: each part of what
 * goes with the report, ticked by default, with its contents a click away.
 */
export function ReportIncluded({
  preview,
  fields,
  locked,
  onChange,
}: {
  preview: BugReportPreview;
  fields: BugReportFields;
  locked: boolean;
  onChange: (change: Partial<BugReportFields>) => void;
}) {
  const { log } = preview;
  const group = (name: BugReportFact["group"]) =>
    preview.facts.filter((f) => f.group === name);
  const removed = new Set(fields.removedFacts);
  const toggleGroup = (facts: BugReportFact[], on: boolean) =>
    onChange({
      removedFacts: on
        ? fields.removedFacts.filter((id) => !facts.some((f) => f.id === id))
        : [...new Set([...fields.removedFacts, ...facts.map((f) => f.id)])],
    });
  const factsPart = (
    label: string,
    facts: BugReportFact[],
    extra?: React.ReactNode,
  ) =>
    facts.length > 0 && (
      <Include
        label={label}
        checked={facts.some((f) => !removed.has(f.id))}
        disabled={locked}
        onChange={(on) => toggleGroup(facts, on)}
      >
        <ul className="report-facts">
          {facts.map((fact) => (
            <li key={fact.id}>
              <label>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={!removed.has(fact.id)}
                  onChange={(e) =>
                    onChange({
                      removedFacts: e.target.checked
                        ? fields.removedFacts.filter((id) => id !== fact.id)
                        : [...fields.removedFacts, fact.id],
                    })
                  }
                />
                <span>{fact.label}</span>
                <code>{fact.value}</code>
              </label>
            </li>
          ))}
        </ul>
        {extra}
      </Include>
    );
  return (
    <div className="report-included">
      {factsPart("Include my system information", group("system"))}
      {factsPart("Include the agents I have installed", group("agents"))}
      {factsPart(
        "Include how Relay and this computer have been running",
        group("performance"),
        <label className="report-perf-file">
          <input
            type="checkbox"
            disabled={locked}
            checked={!!fields.attachPerfLog}
            onChange={(e) => onChange({ attachPerfLog: e.target.checked })}
          />
          Also attach the whole last day of it as a file (you drag it in)
        </label>,
      )}
      <Include
        label={
          log.total === 0
            ? "Include Relay's log (empty so far)"
            : log.included === log.total || !fields.includeLog
              ? `Include Relay's log (${log.total} lines)`
              : `Include Relay's log (newest ${log.included} of ${log.total} lines fit)`
        }
        checked={fields.includeLog}
        disabled={locked || log.total === 0}
        onChange={(includeLog) => onChange({ includeLog })}
      >
        <pre className="report-log">{log.text || "Nothing logged yet."}</pre>
      </Include>
    </div>
  );
}

function Include({
  label,
  checked,
  disabled,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="report-include">
      <div className="report-include-row">
        <label>
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          {label}
        </label>
        <button
          type="button"
          className="text-button"
          aria-expanded={shown}
          onClick={() => setShown((s) => !s)}
        >
          ({shown ? "hide" : "show"})
        </button>
      </div>
      {shown && <div className="report-include-body">{children}</div>}
    </div>
  );
}
