// Where Relay's tools are served: from the agent host, so a call outlives a
// restart of Relay, or from Relay itself when it runs without one.
import { mkdir, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import type { AgentHosts } from "../agent-host/client";
import type { ProjectChats } from "../project-chats";
import { repositoryRoot, type Projects } from "../projects/projects";
import {
  loadRelayMcp,
  serveRelayTools,
  useRelayMcp,
  verifyRelayToken,
  type RelayMcpConfig,
} from "../relay-mcp";
import { StartedThreads, type AgentProjects } from ".";

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
    list: () => projects.list(client()),
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

/** Answers the tools' calls from now on; resolves to how to stop serving them here. */
export async function answerRelayTools(
  config: RelayMcpConfig,
  chats: ProjectChats,
  hosts: AgentHosts | undefined,
  projects: AgentProjects,
) {
  const started = new StartedThreads(chats, { projects });
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
