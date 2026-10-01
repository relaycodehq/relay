import { useState } from "react";
import { agentName, type AgentProvider } from "../../shared/agents";
import { hideAgentSwitchNotice } from "../lib/agent-switch-notice";
import { Modal } from "./ui";

/**
 * Warns that another agent takes over without the current one's session.
 * The outgoing agent writes a handoff note first, so the loss is partial.
 */
export function AgentSwitchDialog({
  from,
  to,
  onDecide,
}: {
  from: AgentProvider;
  to: AgentProvider;
  onDecide: (proceed: boolean) => void;
}) {
  const [hide, setHide] = useState(false);
  const decide = (proceed: boolean) => {
    if (proceed && hide) hideAgentSwitchNotice();
    onDecide(proceed);
  };
  return (
    <Modal
      title={`Switch to ${agentName(to)}?`}
      className="agent-switch-dialog"
      onClose={() => decide(false)}
    >
      <p>
        {agentName(from)} has been working in this thread. {agentName(to)}{" "}
        cannot see its session, tool results, or the files it read.
      </p>
      <p>
        {agentName(from)} will write a handoff note first. {agentName(to)}{" "}
        continues from that note and the recent messages, so expect some context
        to be lost.
      </p>
      <label className="agent-switch-remember">
        <input
          type="checkbox"
          checked={hide}
          onChange={(e) => setHide(e.target.checked)}
        />
        Don’t show this again
      </label>
      <div className="modal-actions">
        <button type="button" onClick={() => decide(false)}>
          Keep {agentName(from)}
        </button>
        <button type="button" className="primary" onClick={() => decide(true)}>
          Switch to {agentName(to)}
        </button>
      </div>
    </Modal>
  );
}
