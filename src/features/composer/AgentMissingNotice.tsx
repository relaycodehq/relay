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
import { InstallLog } from "./InstallLog";
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
  const log =
    (installing || failed) && agent?.update && "output" in agent.update
      ? agent.update.output
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
      {log && <InstallLog output={log} />}
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

/** When Sign in was last pressed, by computer and agent: it watches for the login a while. */
const signInsStarted = new Map<string, number>();
/** Long enough to finish a login in the browser; a check every few seconds till then. */
const signInWatch = 5 * 60_000;

/**
 * The agent is there but signed out. Its login is that computer's own: the
 * sign-in is typed into the thread's terminal there, for the user to run and
 * finish in their browser, and nothing crosses from this computer. Once
 * typed, it looks every few seconds for a while, so the notice goes when the
 * login's done, also after leaving the page and coming back.
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
  const key = `${computer.id}:${provider}`;
  const watching = () =>
    Date.now() - (signInsStarted.get(key) ?? 0) < signInWatch;
  const signedIn = useQuery({
    queryKey: ["agent-signed-in", computer.id, provider],
    // A computer from before it could say answers with an error: no notice.
    queryFn: () => api.agentSignedIn(provider, computer.id),
    staleTime: 60_000,
    retry: false,
    refetchInterval: (query) =>
      query.state.data === false && watching() ? 3000 : false,
  });
  const [, setStarted] = useState(0);
  // Its own clicks only: the checks in the background don't show.
  const [checking, setChecking] = useState(false);
  if (signedIn.data !== false) return null;
  async function signIn() {
    // Signed in some other way meanwhile: nothing to type.
    if ((await signedIn.refetch()).data !== false) return;
    if (await prefillSignIn(projectId, chatId ?? null, provider)) {
      signInsStarted.set(key, Date.now());
      setStarted(Date.now());
    }
  }
  return (
    <div className="agent-missing-notice" role="status">
      <CircleAlert size={14} aria-hidden />
      <span>
        {agentInfo(provider).cli} isn't signed in on {computer.name}.
      </span>
      <button type="button" onClick={() => void signIn()}>
        Sign in
      </button>
      {watching() && (
        <button
          type="button"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void signedIn.refetch().finally(() => setChecking(false));
          }}
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      )}
    </div>
  );
}
