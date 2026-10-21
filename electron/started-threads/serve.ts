// Where Relay's tools are served: from the agent host, so a call outlives a
// restart of Relay, or from Relay itself when it runs without one.
import { mkdir, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import type { AgentHosts } from "../agent-host/client";
import type { ProjectChats } from "../project-chats";
import type { RenderTools } from "../html-renders";
import type { ThreadPreviews } from "../preview";
import { repositoryRoot, type Projects } from "../projects/projects";
import {
  loadRelayMcp,
  serveRelayTools,
  useRelayMcp,
  verifyRelayToken,
  type RelayMcpConfig,
} from "../relay-mcp";
import {
  EARLY_FAILURE_MS,
  StartedThreads,
  type AgentProjects,
  type ReportProblem,
  type ThreadReviews,
  type ThreadHandoffs,
} from ".";
import type { ThreadAgents } from "./thread-agents";
import { agentRuntime } from "../agents";
import type { AgentUpdates } from "../agents/agent-updates";
import { agentOn } from "../../shared/agent-prefs";
import { cantRun } from "../../shared/agent-updates";
import { agentName } from "../../shared/agents";
import type { AISettings } from "../../shared/settings";

/** Finds or makes the tools' port and secret before any agent session starts. */
export async function prepareRelayTools(dir: string) {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const config = await loadRelayMcp(dir);
    useRelayMcp(config);
    return config;
  } catch (error) {
    console.warn("Relay's tools for starting threads are off:", error);
    return undefined;
  }
}

/** The user's projects as the tools reach them; `client` links a new one to its forge, as + does. */
export function agentProjects(
  projects: Projects,
  client: () => Parameters<Projects["add"]>[1],
  userData: string,
): AgentProjects {
  // Real paths, as the folders asked for are compared after links are followed.
  const real = (p: string) => realpath(p).catch(() => p);
  return {
    // A project on another computer has no folder here to start threads in.
    list: async () =>
      (await projects.list(client())).filter((p) => !p.computer),
    add: (folder) => projects.add(folder, client(), { exact: true }),
    repositoryRoot,
    rules: async () => ({
      home: await real(homedir()),
      userData: await real(userData),
      temp: await real(tmpdir()),
      platform: process.platform,
    }),
  };
}

/** The agents as Settings → Agents finds them, and the models their runtimes list. */
export const threadAgents = (
  updates: AgentUpdates,
  ai: () => Pick<AISettings, "agentsOff"> | undefined,
): ThreadAgents => ({
  cantRun: (agent) => {
    if (!agentOn(ai(), agent))
      return `${agentName(agent)} is switched off in Settings → Agents.`;
    const found = updates.current.agents.find((a) => a.provider === agent);
    return found && cantRun(found);
  },
  models: (agent) => agentRuntime(agent).models(),
});

/** Answers the tools' calls from now on; resolves to how to stop serving them here. */
export async function answerRelayTools(
  config: RelayMcpConfig,
  chats: ProjectChats,
  hosts: AgentHosts | undefined,
  projects: AgentProjects,
  options: {
    previews?: ThreadPreviews;
    look?: RenderTools["look"];
    handoffs?: ThreadHandoffs;
    agents?: ThreadAgents;
    restart?: () => void;
    reportProblem?: ReportProblem;
    reviews?: ThreadReviews;
  } = {},
) {
  const started = new StartedThreads(chats, {
    projects,
    failureWatchMs: EARLY_FAILURE_MS,
    ...options,
  });
  if (hosts) {
    hosts.tools = started.handle;
    // The host serves them; this makes sure one of this version runs.
    await hosts
      .ensure()
      .catch((e) => console.warn("No agent host for Relay's tools:", e));
    return async () => {};
  }
  const serving = serveRelayTools(config.port, {
    verify: (token) => verifyRelayToken(config.secret, token),
    call: started.handle,
    log: (line) => console.warn(line),
  });
  await serving.ready.catch((e) =>
    console.warn("Could not serve Relay's tools:", e),
  );
  return serving.close;
}
