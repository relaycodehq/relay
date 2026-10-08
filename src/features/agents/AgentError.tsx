import { CircleAlert } from "lucide-react";
import { agentError } from "./agent-error";
import "./agent-error.css";

export function AgentError({ error }: { error: string }) {
  const { message, hint, details } = agentError(error);
  return (
    <div className="agent-error">
      <CircleAlert size={14} aria-hidden="true" />
      <div className="agent-error-content">
        <p className="agent-error-message" role="status">
          {message}
        </p>
        {hint && <p className="agent-error-hint">{hint}</p>}
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
