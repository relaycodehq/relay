import { CircleAlert, RotateCcw } from "lucide-react";
import { agentError } from "../../../shared/agent-error";
import { openSettings } from "../../lib/settings-page";
import "./agent-error.css";

export function AgentError({
  error,
  interrupted = false,
  onRetry,
  retryDisabled,
}: {
  error: string;
  interrupted?: boolean;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  const { message, hint, details, notInstalled, connectionFailed } =
    agentError(error);
  const continuing = connectionFailed && interrupted;
  return (
    <div className="agent-error">
      <CircleAlert size={14} aria-hidden="true" />
      <div className="agent-error-content">
        <p className="agent-error-message" role="status">
          {continuing ? "Connection to Claude interrupted." : message}
        </p>
        {hint && (
          <p className="agent-error-hint">
            {continuing ? "You can resume when the connection is back." : hint}
          </p>
        )}
        {connectionFailed && onRetry && (
          <button
            type="button"
            className="agent-error-retry"
            disabled={retryDisabled}
            onClick={onRetry}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {continuing ? "Resume answer" : "Try again"}
          </button>
        )}
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
