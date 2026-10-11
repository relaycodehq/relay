import { CircleAlert } from "lucide-react";
import { cantRun } from "../../../shared/agent-updates";
import type { AgentProvider } from "../../../shared/agents";
import { openSettings } from "../../lib/settings-page";
import { useAgentVersions } from "../updates/agent-updates";

/**
 * Says before sending that the composer's agent can't run here, with the way
 * to set it up, instead of letting the message fail after the fact. It knows
 * once Relay has looked for the agents, about 20 s after launch.
 */
export function AgentMissingNotice({
  provider,
}: {
  provider: AgentProvider | "message";
}) {
  const agent = useAgentVersions()?.agents.find((a) => a.provider === provider);
  const reason = agent && cantRun(agent);
  if (!reason) return null;
  return (
    <div className="agent-missing-notice" role="status">
      <CircleAlert size={14} aria-hidden />
      <span>{reason}</span>
      <button type="button" onClick={() => openSettings("agents")}>
        Set up in Settings
      </button>
    </div>
  );
}
