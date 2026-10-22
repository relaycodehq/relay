// What the desktop (electron/main.ts) and the headless Relay
// (electron/headless/daemon.ts) both start, in the same order. Each passes in
// what it does differently: where data lives, how it fetches, what a window
// is told.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AgentHosts } from "../agent-host/client";
import { hostAgents, loadRegistryAgents, watchSavedSignIns } from "../agents";
import { AgentAccounts, setProfilesRoot } from "../agents/accounts";
import {
  AcpRegistry,
  configureAcpRegistry,
  configureAntigravity,
} from "../agents/acp";
import { configureCursor } from "../agents/cursor/sdk";
import { keepUsageHistory } from "../agents/usage-history";
import type { KeepAwake } from "../app/keep-awake";
import { GiteaLogin, seal, unseal } from "../app/login";
import type { Store } from "../app/store";
import { rearmOnWake } from "../app/wake";
import { setPastesRoot, sweepPastes } from "../drafts";
import { gitExecutable, setGitPath } from "../git/git";
import type { GithubLogin } from "../github";
import { Computers } from "../handoff/computers";
import { HandoffReceiver, type ReceiverHost } from "../handoff/receiver";
import { RemoteProjects } from "../handoff/remote-projects";
import { Handoffs } from "../handoff/sender";
import { setLinkedAgents, setOwnAgentsDir } from "../platform/executables";
import { ClockifyPlugin } from "../plugins/clockify/service";
import { DevOps } from "../plugins/devops/service";
import { PluginSecrets } from "../plugins/secrets";
import { ProjectChats } from "../project-chats";
import { ChatSummaryFeed } from "../project-chats/chat-summaries";
import { PullMerges } from "../project-chats/pull-merges";
import type { ProjectAdding } from "../project-add";
import type { AppPrefs } from "../settings";
import { Projects } from "../projects/projects";
import { pullRequestHosts } from "../pull-requests/setup";
import type { RemoteHost } from "../remote/bridge";
import { PhoneRemote } from "../remote/phone-remote";
import { applyLinkedTools } from "../source-control";
import {
  agentProjects,
  answerRelayTools,
  prepareRelayTools,
  threadAgents,
} from "../started-threads/serve";
import { projectTasks } from "../terminal/tasks";
import { keepUsageLog } from "../usage";
import type { AgentUpdates } from "../agents/agent-updates";
import type { Dispatch } from "../api";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type PowerMonitor = Parameters<typeof rearmOnWake>[0];

/**
 * The agents Relay downloads rather than ships: Cursor's SDK, run in
 * `cursorWorker`, Antigravity's ACP server and the ACP registry's agents.
 */
export function downloadedAgents(
  dir: string,
  fetch: Fetch,
  cursorWorker: string,
) {
  configureCursor({
    worker: cursorWorker,
    root: join(dir, "cursor-sdk"),
    store: join(dir, "cursor-agents"),
    fetch,
  });
  configureAntigravity({ root: join(dir, "antigravity"), fetch });
  const registry = new AcpRegistry(join(dir, "acp-agents"), fetch);
  configureAcpRegistry(registry);
  return registry;
}

/**
 * Points what keeps files at Relay's data folder, applies what the user
 * linked, and reads the agents' accounts: before anything starts an agent,
 * as runs ask which account they use.
 */
export async function prepareData(
  dir: string,
  store: Store,
  accountsChanged: ConstructorParameters<typeof AgentAccounts>[1],
) {
  setGitPath(store.get().gitPath ?? null);
  setLinkedAgents(store.get().agentPaths ?? {});
  setOwnAgentsDir(join(dir, "agent-clis"));
  setProfilesRoot(join(dir, "agent-accounts"));
  setPastesRoot(join(dir, "pastes"));
  void sweepPastes([
    join(dir, "project-chats"),
    join(dir, "drafts.json"),
    join(dir, "state.json"),
  ]).catch((e) => console.warn("Could not sweep old pastes:", e));
  const accounts = new AgentAccounts(store, accountsChanged);
  watchSavedSignIns();
  applyLinkedTools(store);
  // Found once up front, every Git call after starts right away.
  void gitExecutable().catch(() => {});
  return accounts;
}

/**
 * Where the agents' sessions run, so they outlive a restart of Relay, and
 * the tools each session gets. The host runs from `script`, a plain file.
 */
export async function agentHost(dir: string, script: string) {
  let hosts: AgentHosts | undefined;
  if (existsSync(script)) {
    const started = new AgentHosts(join(dir, "agent-host"), script);
    hosts = started;
    hostAgents(started);
    projectTasks.hosts = () => started.pids();
  }
  // Before any agent session starts, so each gets the tools.
  const tools = await prepareRelayTools(join(dir, "agent-host"));
  return { hosts, tools };
}

/** Projects, their threads and what follows them: pull requests, DevOps cards, Clockify. */
export function threadServices({
  dir,
  store,
  fetch,
  login,
  github,
  online,
  chatEvent,
  prefs,
}: {
  dir: string;
  store: Store;
  fetch: Fetch;
  login: GiteaLogin;
  github: GithubLogin;
  online: () => boolean;
  chatEvent: ConstructorParameters<typeof ProjectChats>[3];
  /** settings.json's preferences as they are now. */
  prefs: () => AppPrefs;
}) {
  const projects = new Projects(store);
  const pullHosts = pullRequestHosts({ store, login, github, projects, fetch });
  const devops = new DevOps(
    store,
    fetch,
    seal,
    unseal,
    join(dir, "devops-relevance.json"),
    pullHosts.azureTokens,
  );
  keepUsageHistory(join(dir, "usage-history.json"));
  keepUsageLog(join(dir, "usage.jsonl"));
  const chats = new ProjectChats(
    store,
    projects,
    join(dir, "project-chats"),
    chatEvent,
    pullHosts.evidence,
    prefs,
  );
  const pullMerges = new PullMerges({
    chats: () => store.get().chats ?? [],
    ...pullHosts.merges,
    record: (id) => chats.pullMerged(id),
    online,
  });
  const clockify = new ClockifyPlugin({
    store,
    secrets: new PluginSecrets(store, seal, unseal),
    fetch,
    chats: {
      summaries: () => store.get().chats ?? [],
      get: (id) => chats.get(id),
    },
    projectName: (id) => {
      try {
        return projects.get(id).name;
      } catch {
        return "Removed project";
      }
    },
    aiSettings: () => store.aiSettings(),
  });
  return { projects, pullHosts, devops, chats, pullMerges, clockify };
}

/**
 * Sends the thread lists to whoever shows them as they change, and keeps
 * time moving: a quiet thread settles itself as days pass, one whose PR
 * merged when the host says so, and worktrees nothing needs are cleaned up.
 */
export function followSummaries({
  chats,
  listChats,
  pullMerges,
  login,
  keepAwake,
  send,
  changed,
}: {
  chats: ProjectChats;
  listChats: ConstructorParameters<typeof ChatSummaryFeed>[0];
  pullMerges: PullMerges;
  login: GiteaLogin;
  keepAwake: KeepAwake;
  send: ConstructorParameters<typeof ChatSummaryFeed>[1];
  /** Something else to tell when a project's threads change. */
  changed?: () => void;
}) {
  const summaries = new ChatSummaryFeed(listChats, send);
  chats.onSummaries((projectId) => {
    summaries.changed(projectId);
    changed?.();
    void keepAwake.refresh();
  });
  // Settings, phone access and the power source change without a thread noticing.
  setInterval(() => void keepAwake.refresh(), 15_000).unref();
  // Whether a PR thread's review began reads with the account.
  login.changed = () => {
    chats.summariesChanged();
    void pullMerges.sweep();
  };
  setInterval(() => {
    chats.summariesChanged();
    void pullMerges.sweep();
    void chats.cleanUpWorktrees();
  }, 5 * 60_000).unref();
  // Not right at launch: the thread a window opens on first says it's shown.
  setTimeout(() => void chats.cleanUpWorktrees(), 60_000).unref();
}

/**
 * The computers threads are handed to and the bridge phones and computers
 * reach this one through. The host's speech, drafts and images are this
 * Relay's own; `updates` lets a paired device update it.
 */
export function remoteServices({
  dir,
  store,
  projects,
  chats,
  login,
  listChats,
  dispatch,
  adding,
  version,
  updates,
  computers: computerOptions,
  host,
  port,
}: {
  dir: string;
  store: Store;
  projects: Projects;
  chats: ProjectChats;
  login: GiteaLogin;
  listChats: RemoteHost["chats"];
  dispatch: Dispatch;
  adding: ProjectAdding;
  version: () => string;
  updates: ReceiverHost["updates"];
  computers?: ConstructorParameters<typeof Computers>[3];
  host: Pick<
    RemoteHost,
    "present" | "shrinkImage" | "drafts" | "dictation" | "readAloud"
  >;
  port?: number;
}) {
  const handoffDir = join(dir, "handoffs");
  const computers = new Computers(store, seal, unseal, computerOptions);
  const handoffs = {
    computers,
    remote: new RemoteProjects(computers, projects),
    sender: new Handoffs(
      store,
      computers,
      chats,
      projects,
      join(handoffDir, "out"),
    ),
  };
  const receiver = new HandoffReceiver({
    projects: () => projects.list(login.client),
    root: (id) => projects.root(id),
    chats,
    worktrees: join(dir, "worktrees"),
    dir: join(handoffDir, "in"),
    version,
    dispatch,
    adding,
    updates,
  });
  const phoneRemote = new PhoneRemote(
    store,
    seal,
    unseal,
    {
      projects: () => projects.list(login.client),
      pairedComputers: () => computers.list(),
      projectPath: (id) => projects.get(id).path,
      chats: listChats,
      chat: (id, known) => (known ? chats.changes(id, known) : chats.get(id)),
      cost: (id) => chats.cost(id),
      version,
      // The bridge forwards only its allowlist; see shared/remote.ts.
      dispatch,
      renderPage: (chatId, renderId, page) =>
        chats.renderPage(chatId, renderId, page),
      news: (cursor) => chats.newsSince(cursor),
      handoffs: receiver,
      ...host,
    },
    port,
  );
  return { handoffs, receiver, phoneRemote };
}

/**
 * Agent sessions that kept running through a restart come back, Relay's own
 * tools start answering them, and threads waiting on a time wake at it.
 */
export async function resumeThreads({
  dir,
  chats,
  projects,
  login,
  agentHosts,
  relayTools,
  agentUpdates,
  aiSettings,
  tools,
  powerMonitor,
}: {
  dir: string;
  chats: ProjectChats;
  projects: Projects;
  login: GiteaLogin;
  agentHosts: AgentHosts | undefined;
  relayTools: Awaited<ReturnType<typeof prepareRelayTools>>;
  agentUpdates: AgentUpdates;
  aiSettings: Parameters<typeof threadAgents>[1];
  tools: Omit<NonNullable<Parameters<typeof answerRelayTools>[4]>, "agents">;
  powerMonitor: PowerMonitor;
}) {
  await loadRegistryAgents();
  await chats.reattach();
  if (relayTools)
    void answerRelayTools(
      relayTools,
      chats,
      agentHosts,
      agentProjects(projects, () => login.client, dir),
      { ...tools, agents: threadAgents(agentUpdates, aiSettings) },
    );
  chats.armWakeups();
  void chats
    .reconcileSummaries()
    .catch((e) => console.warn("Could not reconcile thread summaries:", e));
  rearmOnWake(powerMonitor, () => chats.armWakeups());
}
