import type { LeadAgent } from "../../../shared/deep-review";
import { ModelField } from "../agents/ModelField";
import { useOfferedAgents } from "../agents/registry-agents";

/** Who merges and verifies the findings, and whether it may run tests to. */
export function LeadField({
  lead,
  runChecks,
  onChange,
}: {
  lead: LeadAgent;
  runChecks: boolean;
  onChange: (patch: { lead?: LeadAgent; runChecks?: boolean }) => void;
}) {
  const runnable = useOfferedAgents(lead.provider);
  return (
    <div className="deep-review-field">
      <span className="deep-review-label">Lead</span>
      <div className="deep-review-field-body deep-review-lead">
        <ModelField
          label="Lead"
          provider={lead.provider}
          providers={runnable}
          value={lead.choice}
          onChange={(choice, provider) =>
            onChange({ lead: { provider, choice } })
          }
        />
        <span className="deep-review-note">
          Merges and verifies the findings, then fixes them with you.
        </span>
        <label className="deep-review-check">
          <input
            type="checkbox"
            checked={runChecks}
            onChange={(e) => onChange({ runChecks: e.target.checked })}
          />
          Can run tests to verify
        </label>
      </div>
    </div>
  );
}
