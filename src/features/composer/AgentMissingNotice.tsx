import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cantRun,
  notLookedFor,
  type AgentVersion,
} from "../../../shared/agent-updates";
import type { AgentProvider } from "../../../shared/agents";
import { api } from "../../lib/api";
import { openSettings } from "../../lib/settings-page";
import { useAgentVersions } from "../updates/agent-updates";

/**
 * Says before sending that the composer's agent can't run where it would,
 * with the way to set it up, instead of letting the message fail after the
 * fact. Here it knows once Relay has looked for the agents, about 20 s after
 * launch; for a project on a paired `computer`, once that computer answered.
 */
export function AgentMissingNotice({
  provider,
  computer,
}: {
  provider: AgentProvider | "message";
  computer?: { id: string; name: string };
}) {
  return computer ? (
    <ComputerAgentMissing provider={provider} computer={computer} />
  ) : (
    <LocalAgentMissing provider={provider} />
  );
}

function LocalAgentMissing({
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

/** Its agents are installed and signed in there, in its terminal; this one can only look again. */
function ComputerAgentMissing({
  provider,
  computer,
}: {
  provider: AgentProvider | "message";
  computer: { id: string; name: string };
}) {
  const qc = useQueryClient();
  const queryKey = ["agent-versions", computer.id];
  const versions = useQuery({
    queryKey,
    queryFn: async () => {
      const found = await api.agentVersions(computer.id);
      // A Relay just started there hasn't looked for its agents yet: it looks now.
      const mine = found.agents.find((a) => a.provider === provider);
      return mine && notLookedFor(mine)
        ? api.checkAgentVersions(computer.id)
        : found;
    },
    staleTime: 60_000,
    retry: false,
  });
  const [checking, setChecking] = useState(false);
  const agent = versions.data?.agents.find(
    (a: AgentVersion) => a.provider === provider,
  );
  const reason = versions.isError
    ? `Couldn't ask ${computer.name} which agents it has.`
    : agent && cantRun(agent, computer.name);
  if (!reason) return null;
  async function checkAgain() {
    setChecking(true);
    try {
      qc.setQueryData(queryKey, await api.checkAgentVersions(computer.id));
    } catch {
      await versions.refetch();
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="agent-missing-notice" role="status">
      <CircleAlert size={14} aria-hidden />
      <span>{reason}</span>
      <button type="button" disabled={checking} onClick={checkAgain}>
        {checking ? "Checking…" : "Check again"}
      </button>
    </div>
  );
}
