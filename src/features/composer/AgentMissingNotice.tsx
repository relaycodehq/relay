import { useState } from "react";
import { CircleAlert, Download } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cantRun,
  isUpdating,
  notLookedFor,
  type AgentVersion,
  type AgentVersions,
} from "../../../shared/agent-updates";
import {
  agentInfo,
  isCliProvider,
  type AgentProvider,
} from "../../../shared/agents";
import { api } from "../../lib/api";
import { openSettings } from "../../lib/settings-page";
import { prefillSignIn } from "../terminal/thread-terminals";
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
  projectId,
  chatId,
}: {
  provider: AgentProvider | "message";
  computer?: { id: string; name: string };
  /** Where a sign-in on `computer` is typed: the thread's terminal, there. */
  projectId: string;
  chatId?: string;
}) {
  return computer ? (
    <ComputerAgentMissing
      provider={provider}
      computer={computer}
      projectId={projectId}
      chatId={chatId}
    />
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

/**
 * Its agents are installed and signed in there. A missing CLI Relay there
 * installs into its own folder on Install; anything else it can only look
 * at again.
 */
function ComputerAgentMissing({
  provider,
  computer,
  projectId,
  chatId,
}: {
  provider: AgentProvider | "message";
  computer: { id: string; name: string };
  projectId: string;
  chatId?: string;
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
    // While it installs there, how it's going.
    refetchInterval: (query) =>
      mineIn(query.state.data, provider) &&
      isUpdating(mineIn(query.state.data, provider)!)
        ? 2000
        : false,
  });
  const [checking, setChecking] = useState(false);
  const agent = mineIn(versions.data, provider);
  const installing = !!agent && isUpdating(agent);
  const failed =
    agent?.update?.status === "failed" && !agent.path
      ? agent.update.message
      : undefined;
  const cli = agentInfo(provider)?.cli ?? provider;
  const reason = versions.isError
    ? `Couldn't ask ${computer.name} which agents it has.`
    : installing
      ? `Installing ${cli} on ${computer.name}…`
      : failed
        ? `Couldn't install ${cli} on ${computer.name}: ${failed}`
        : agent && cantRun(agent, computer.name);
  // A CLI that isn't there at all; one that is but won't run is the user's to fix.
  const installable =
    !!agent && isCliProvider(agent.provider) && !agent.path && !installing;
  if (!reason)
    return agent && provider !== "message" ? (
      <ComputerSignedOut
        provider={provider}
        computer={computer}
        projectId={projectId}
        chatId={chatId}
      />
    ) : null;
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
  async function install(agent: AgentVersion) {
    try {
      qc.setQueryData(
        queryKey,
        await api.installAgent(agent.provider, computer.id),
      );
    } catch {
      await versions.refetch();
    }
  }
  return (
    <div
      className={`agent-missing-notice${installing ? " busy" : ""}`}
      role="status"
    >
      {installing ? (
        <Download size={14} aria-hidden />
      ) : (
        <CircleAlert size={14} aria-hidden />
      )}
      <span>{reason}</span>
      {installable && (
        <button type="button" onClick={() => void install(agent)}>
          Install
        </button>
      )}
      {!installing && (
        <button type="button" disabled={checking} onClick={checkAgain}>
          {checking ? "Checking…" : "Check again"}
        </button>
      )}
    </div>
  );
}

const mineIn = (versions: AgentVersions | undefined, provider: string) =>
  versions?.agents.find((a: AgentVersion) => a.provider === provider);

/**
 * The agent is there but signed out. Its login is that computer's own: the
 * sign-in is typed into the thread's terminal there, for the user to run and
 * finish in their browser, and nothing crosses from this computer.
 */
function ComputerSignedOut({
  provider,
  computer,
  projectId,
  chatId,
}: {
  provider: AgentProvider;
  computer: { id: string; name: string };
  projectId: string;
  chatId?: string;
}) {
  const signedIn = useQuery({
    queryKey: ["agent-signed-in", computer.id, provider],
    // A computer from before it could say answers with an error: no notice.
    queryFn: () => api.agentSignedIn(provider, computer.id),
    staleTime: 60_000,
    retry: false,
  });
  const [typed, setTyped] = useState(false);
  if (signedIn.data !== false) return null;
  async function signIn() {
    setTyped(await prefillSignIn(projectId, chatId ?? null, provider));
  }
  return (
    <div className="agent-missing-notice" role="status">
      <CircleAlert size={14} aria-hidden />
      <span>
        {agentInfo(provider).cli} isn't signed in on {computer.name}.
      </span>
      {typed ? (
        <button
          type="button"
          disabled={signedIn.isFetching}
          onClick={() => void signedIn.refetch()}
        >
          {signedIn.isFetching ? "Checking…" : "Check again"}
        </button>
      ) : (
        <button type="button" onClick={() => void signIn()}>
          Sign in
        </button>
      )}
    </div>
  );
}
