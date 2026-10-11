import { CircleAlert } from "lucide-react";
import { agentError } from "../../../shared/agent-error";
import { openSettings } from "../../lib/settings-page";
import "./agent-error.css";

export function AgentError({ error }: { error: string }) {
  const { message, hint, details, notInstalled } = agentError(error);
  return (
    <div className="agent-error">
      <CircleAlert size={14} aria-hidden="true" />
      <div className="agent-error-content">
        <p className="agent-error-message" role="status">
          {message}
        </p>
        {hint && <p className="agent-error-hint">{hint}</p>}
        {notInstalled && (
          <button
            type="button"
            className="agent-error-action"
            onClick={() => openSettings("agents")}
          >
            Set up in Settings
          </button>
        )}
        {details && (
          <details className="agent-error-details">
            <summary>Technical details</summary>
            <pre>{details}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
