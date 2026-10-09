// Relay without its window: the desktop's own services, started the way
// electron/main.ts starts them, for a computer that's only ever reached from
// a phone or another computer. The `relay` command talks to it through
// ./control; phones and computers through the same bridge as the desktop's.
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:net";
import { join } from "node:path";
import { AgentHosts } from "../agent-host/client";
import { hostAgents, loadRegistryAgents, setOpenCodeEnvRoot } from "../agents";
import {
  AgentAccounts,
  accountHomes,
  setProfilesRoot,
} from "../agents/accounts";
import { AgentUpdates, machineIo } from "../agents/agent-updates";
import {
  cursorSdkIo,
  signInCursor,
  signOutCursor,
} from "../agents/cursor/account";
import { configureCursor } from "../agents/cursor/sdk";
import {
  AcpRegistry,
  antigravityIo,
  configureAcpRegistry,
  configureAntigravity,
  registryUpdatesIo,
} from "../agents/acp";
import { keepUsageHistory } from "../agents/usage-history";
import { createDispatch, type Dispatch } from "../api";
import { apiContext } from "../api/context";
import { DevBuild } from "../app/dev-build";
import { KeepAwake } from "../app/keep-awake";
import { AppLinks } from "../app/links";
import { GiteaLogin, seal, unseal } from "../app/login";
import { Menubar } from "../app/menubar";
import { Store } from "../app/store";
import { Updater } from "../app/updater";
import { rearmOnWake } from "../app/wake";
import { AppWindow } from "../app/window";
import { ProjectChecks } from "../checks/service";
import { Ci } from "../ci";
import { Dictation, setSherpaDir } from "../dictation/service";
import { BlameService } from "../git/blame";
import { gitExecutable, setGitPath } from "../git/git";
import { flushWorkingFiles } from "../git/working-files";
import { flushGitOperations } from "../git/working-tree";
import { Computers } from "../handoff/computers";
import { HandoffReceiver } from "../handoff/receiver";
import { Handoffs } from "../handoff/sender";
import { setComputerName, computerName } from "../platform/computer-name";
import { setLinkedAgents, setOwnAgentsDir } from "../platform/executables";
import { pathReady } from "../platform/shell-path";
import { ClockifyPlugin } from "../plugins/clockify/service";
import { DevOps } from "../plugins/devops/service";
import { PluginSecrets } from "../plugins/secrets";
import { ProjectChats } from "../project-chats";
import { ChatSummaryFeed } from "../project-chats/chat-summaries";
import { PullMerges } from "../project-chats/pull-merges";
import { Projects } from "../projects/projects";
import { ProjectAdding } from "../project-add";
import { TerminalSessions } from "../terminal-sessions";
import { GithubLogin } from "../pull-requests/github-login";
import type { Repo } from "../../shared/types";
import { isGithubServer } from "../../shared/source-control";
import { mergedPulls } from "../pull-requests/merged";
import { PullRequestCreation } from "../pull-requests/pull-request-create";
import { questionContext } from "../pull-requests/questions";
import { ReadAloud, setOnnxRuntimeDir } from "../read-aloud";
import { PhoneAppFiles } from "../remote/phone-app";
import { PhoneRemote } from "../remote/phone-remote";
import { applyLinkedTools } from "../source-control";
import {
  agentProjects,
  answerRelayTools,
  prepareRelayTools,
} from "../started-threads/serve";
import { projectTasks } from "../terminal/tasks";
import { TriageService } from "../triage/service";
import { keepUsageLog } from "../usage";
import type { ChatSummary } from "../../shared/projects";
import {
  serveControl,
  type ControlApi,
  type CursorLogin,
  type ThreadRow,
} from "./control";
import { onAppQuit, powerMonitor } from "./electron-stand-in";
import {
  autoUpdateEnabled,
  claimHome,
  restartCode,
  spawnRelay,
} from "./launch";
import { headlessPaths, prepareControlSocket } from "./paths";
import { headlessPower } from "./power";
import { compressImage } from "./image";
import { HeadlessSpeech, SpeechRuntime } from "./speech";
import { keepUpdated } from "./auto-update";
import { HeadlessUpdater, installRoot } from "./updater";
import { headlessVersion } from "./version";

export { logTo } from "./log";

export interface DaemonOptions {
  home: string;
  /** The bridge's port; the desktop's own by default. */
  port?: number;
  /** What phones and other computers call this one; the host name by default. */
  name?: string;
}

const fetcher = (url: string | URL | Request, init?: RequestInit) =>
  fetch(url, init);

/** Starts everything and resolves once Relay is answering; exits the process when stopped. */
export async function runDaemon({ home, port, name }: DaemonOptions) {
  const paths = headlessPaths(home);
  const startedAt = Date.now();
  const releaseHome = await claimHome(paths.pid);
  paths.control = await prepareControlSocket(home);
  setComputerName(name);
  // Started this early, the login shell has usually answered before the first
  // CLI lookup waits for it.
  void pathReady();
  const store = new Store(home);
  await store.load();
  let phoneRemote: PhoneRemote | undefined;
  let handoffs: { computers: Computers; sender: Handoffs } | undefined;
  let agentHosts: AgentHosts | undefined;
  // The host runs from a plain file beside this one.
  const hostScript = join(__dirname, "agent-host.mjs");
  if (existsSync(hostScript)) {
    const hosts = new AgentHosts(join(home, "agent-host"), hostScript);
    agentHosts = hosts;
    hostAgents(hosts);
    projectTasks.hosts = () => hosts.pids();
  }
  // Before any agent session starts, so each gets the tools.
  const relayTools = await prepareRelayTools(join(home, "agent-host"));
  setGitPath(store.get().gitPath ?? null);
  setLinkedAgents(store.get().agentPaths ?? {});
  setOwnAgentsDir(join(home, "agent-clis"));
  setProfilesRoot(join(home, "agent-accounts"));
  setOpenCodeEnvRoot(join(home, "opencode"));
  configureCursor({
    worker: join(__dirname, "cursor-worker.mjs"),
    root: join(home, "cursor-sdk"),
    store: join(home, "cursor-agents"),
    fetch: fetcher,
  });
  configureAntigravity({ root: join(home, "antigravity"), fetch: fetcher });
  const acpAgents = new AcpRegistry(join(home, "acp-agents"), fetcher);
  configureAcpRegistry(acpAgents);
  const agentAccounts = new AgentAccounts(store, () => {});
  applyLinkedTools(store);
  void gitExecutable().catch(() => {});
  const login = new GiteaLogin();
  const projects = new Projects(store);
  const github = new GithubLogin(fetcher);
  const hostOf = async (repo: Repo) =>
    isGithubServer(repo.server) ? github.require() : login.require();
  async function projectHost(projectId: string) {
    const repository = projects.get(projectId).repository;
    if (!repository) return null;
    return isGithubServer(repository.server) ? github.require() : login.client;
  }
  const devops = new DevOps(
    store,
    fetcher,
    seal,
    unseal,
    join(home, "devops-relevance.json"),
  );
  keepUsageHistory(join(home, "usage-history.json"));
  keepUsageLog(join(home, "usage.jsonl"));
  const chats = new ProjectChats(
    store,
    projects,
    join(home, "project-chats"),
    (event) => phoneRemote?.chatEvent(event),
    async (chat, selection) => {
      if (chat.scope.kind !== "pr")
        throw new Error("This is not a pull request conversation.");
      const client = await projectHost(chat.projectId);
      if (!client)
        throw new Error(
          "Relay can't match this project to a GitHub or Gitea repository.",
        );
      const repo = await projects.linked(chat.projectId, client);
      if (
        repo.owner !== chat.scope.ref.owner ||
        repo.name !== chat.scope.ref.name
      )
        throw new Error("The selected PR does not match this project.");
      return questionContext(client, chat.scope.ref, selection);
    },
  );
  const keepAwake = new KeepAwake(
    {
      enabled: () => store.get().keepAwake ?? true,
      busy: () => chats.working() > 0 || !!phoneRemote?.expectsCalls(),
    },
    headlessPower(),
  );
  const pullMerges = new PullMerges({
    chats: () => store.get().chats ?? [],
    repository: async (projectId) => {
      const client = await projectHost(projectId).catch(() => null);
      return client
        ? projects.linked(projectId, client).catch(() => null)
        : null;
    },
    mergedAmong: async (repo, numbers, signal) =>
      mergedPulls(await hostOf(repo), repo, numbers, signal),
    merged: async (repo, number) =>
      !!(await (await hostOf(repo)).pull({ ...repo, number })).merged,
    record: (id) => chats.pullMerged(id),
    online: () => true,
  });
  const clockify = new ClockifyPlugin({
    store,
    secrets: new PluginSecrets(store, seal, unseal),
    fetch: fetcher,
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
  // The window's services, built so the dispatch has them; with no window
  // they never open one, and what they'd show goes nowhere.
  // Speech for phones, its engines downloaded into the home folder when set up.
  const runtime = new SpeechRuntime(home, __dirname, fetcher);
  setSherpaDir(runtime.sherpaDir);
  setOnnxRuntimeDir(runtime.ortDir);
  await runtime.prepare();
  const dictation = new Dictation(home, () => {});
  const readAloud = new ReadAloud(
    home,
    {
      get: () => store.get().readAloud,
      save: (settings) =>
        store.update((s) => {
          s.readAloud = settings;
        }),
    },
    () => {},
  );
  const speech = new HeadlessSpeech(runtime, dictation, readAloud);
  void speech.catchUp();
  const window = new AppWindow({
    closed: () => {},
    quitCancelled: () => {},
    reloaded: () => {},
    rendererGone: () => {},
  });
  const agentUpdates = new AgentUpdates(() => {}, {
    ...machineIo,
    fetch: fetcher,
    sdks: { cursor: cursorSdkIo, antigravity: antigravityIo },
    registry: registryUpdatesIo(acpAgents),
  });
  acpAgents.onChange(() => void agentUpdates.sync());
  const triage = new TriageService(store, home);
  const api = apiContext({
    store,
    projects,
    projectChats: chats,
    pullMerges,
    devops,
    clockify,
    triage,
    phoneRemote: () => phoneRemote,
    handoffs: () => handoffs,
    login,
    github,
    window,
    menubar: new Menubar(
      () => {},
      () => chats.working(),
    ),
    links: new AppLinks(window, () => !!login.client),
    projectChecks: new ProjectChecks(join(__dirname, "checks-worker.mjs")),
    blame: new BlameService(),
    ci: new Ci(fetcher),
    pullRequestCreation: new PullRequestCreation(),
    updater: new Updater(() => {}),
    devBuild: new DevBuild(() => {}, {
      quit: () => {
        void shutDown(true, { restart: true });
      },
    }),
    dictation,
    readAloud,
    agentUpdates,
    agentAccounts,
    projectAdding: new ProjectAdding({
      store,
      projects,
      client: () => login.client,
      sessions: new TerminalSessions(async () => accountHomes()),
      appData: home,
      send: () => {},
    }),
  });
  const dispatch: Dispatch = createDispatch(api);
  const summaries = new ChatSummaryFeed(api.listChats, (event) =>
    phoneRemote?.chatsEvent(event),
  );
  chats.onSummaries((projectId) => {
    summaries.changed(projectId);
    void keepAwake.refresh();
  });
  setInterval(() => void keepAwake.refresh(), 15_000).unref();
  login.changed = () => {
    chats.summariesChanged();
    void pullMerges.sweep();
  };
  // A quiet thread settles itself as days pass; the feed sends only what changed.
  setInterval(() => {
    chats.summariesChanged();
    void pullMerges.sweep();
    void chats.cleanUpWorktrees();
  }, 5 * 60_000).unref();
  setTimeout(() => void chats.cleanUpWorktrees(), 60_000).unref();
  const updater = new HeadlessUpdater(installRoot(__dirname), headlessVersion, {
    restart: () => {
      setTimeout(() => void shutDown(true, { restart: true }), 50);
    },
  });
  const handoffDir = join(home, "handoffs");
  const computers = new Computers(store, seal, unseal);
  handoffs = {
    computers,
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
    worktrees: join(home, "worktrees"),
    dir: join(handoffDir, "in"),
    version: () => headlessVersion,
    // A paired computer or phone may update this one, as on the desktop.
    updates: {
      state: () => updater.now,
      check: () => updater.check(),
      download: () => updater.download(),
      install: () => updater.install(),
    },
  });
  const remote = new PhoneRemote(
    store,
    seal,
    unseal,
    {
      projects: () => projects.list(login.client),
      projectPath: (id) => projects.get(id).path,
      chats: api.listChats,
      chat: (id, known) => (known ? chats.changes(id, known) : chats.get(id)),
      version: () => headlessVersion,
      // The bridge forwards only its allowlist; see shared/remote.ts.
      dispatch,
      phoneApp: new PhoneAppFiles(join(__dirname, "../dist-phone")),
      // Images go to phones whole, re-encoded smaller where that's possible.
      shrinkImage: (dataUrl) => compressImage(dataUrl),
      dictation: speech.forPhones.dictation,
      readAloud: speech.forPhones.readAloud,
      handoffs: receiver,
    },
    port,
  );
  phoneRemote = remote;
  // Default phone access on once, even if Tailscale isn't available yet.
  // start() watches for it; an explicitly saved false remains false.
  await remote.start(true);
  void computers.start();
  // Agent sessions that kept running through a restart come back first.
  await loadRegistryAgents();
  await chats.reattach();
  if (relayTools)
    void answerRelayTools(
      relayTools,
      chats,
      agentHosts,
      agentProjects(projects, () => login.client, home),
    );
  chats.armWakeups();
  void chats
    .reconcileSummaries()
    .catch((e) => console.warn("Could not reconcile thread summaries:", e));
  rearmOnWake(powerMonitor, () => chats.armWakeups());
  if (!process.env.RELAY_TEST_DATA) {
    agentUpdates.start();
    keepUpdated(updater, {
      enabled: () => autoUpdateEnabled(home),
      busy: () => chats.working() > 0 || receiver.busy,
    });
  }
  void login.restoreSaved(store);
  void keepAwake.refresh();

  let control: Server | undefined;
  let stopping: Promise<void> | undefined;
  /**
   * Saves everything and exits; `detach` leaves the agents' sessions with
   * the agent host. `restart` starts Relay again: a service manager does it
   * for a failing exit, otherwise a fresh Relay is started on the way out.
   */
  const shutDown = (detach: boolean, { restart = false } = {}) =>
    (stopping ??= (async () => {
      console.log(
        restart
          ? "Restarting; running agents carry on in the agent host."
          : detach
            ? "Stopping; running agents carry on in the agent host."
            : "Stopping.",
      );
      control?.close();
      try {
        await remote.close();
        computers.close();
        if (detach) agentHosts?.detach();
        await chats.dispose({ detach });
        await Promise.all([
          store.flush(),
          flushWorkingFiles(),
          flushGitOperations(),
        ]);
      } catch (e) {
        console.error("Stopping didn't finish cleanly:", e);
      }
      keepAwake.dispose();
      dictation.stopWorker();
      readAloud.stopWorker();
      if (process.platform !== "win32")
        await rm(paths.control, { force: true });
      await releaseHome();
      if (restart && process.env.RELAY_SERVICE) process.exit(restartCode);
      if (restart) spawnRelay(home, join(__dirname, "relay.cjs"));
      process.exit(0);
    })());
  onAppQuit(() => void shutDown(false));
  // A signal is a restart from a service manager or a script: the agents'
  // sessions carry on in the agent host and come back after it, as on the desktop.
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
    process.on(signal, () => void shutDown(true));

  /** Cursor's sign-in, done on another device from the link it gives. */
  let cursorLogin: CursorLogin | undefined;

  const listThreads = async (): Promise<ThreadRow[]> => {
    const list = await projects.list(login.client);
    return list
      .flatMap((project) =>
        api
          .listChats(project.id)
          .filter((chat) => !chat.empty && !chat.archivedAt)
          .map((chat) => threadRow(chat, project.name)),
      )
      .sort((a, b) => b.updated - a.updated);
  };

  const controlApi: ControlApi = {
    async status() {
      const known = agentUpdates.current;
      const [state, list, versions] = await Promise.all([
        remote.state(),
        projects.list(login.client),
        // Asked once; after that a stale answer goes out while a fresh one is found.
        known.checkedAt ? known : agentUpdates.check(),
      ]);
      if (known.checkedAt && Date.now() - known.checkedAt > 5 * 60_000)
        void agentUpdates.check().catch(() => {});
      const rows = list.flatMap((p) => api.listChats(p.id));
      return {
        version: headlessVersion,
        name: computerName(),
        pid: process.pid,
        startedAt,
        home,
        remote: state,
        projects: list.length,
        threads: {
          working: rows.filter((c) => c.running).length,
          waiting: rows.filter((c) => c.waiting).length,
          total: rows.filter((c) => !c.empty && !c.archivedAt).length,
        },
        agents: versions.agents,
        update: updater.now,
      };
    },
    async pair() {
      if (!remote.devices.settings.enabled || !(await remote.state()).listening)
        await remote.setEnabled(true);
      const pairing = await remote.pairing();
      return { ...pairing, remote: await remote.state() };
    },
    update: (check) => (check ? updater.check() : updater.install()),
    remote: (enabled) => remote.setEnabled(enabled),
    removeDevice: (id) => remote.revoke(id),
    projects: () => projects.list(login.client),
    addProject: (path) => projects.add(path, login.client),
    removeProject: async (id) => {
      await dispatch("removeProject", [id]);
    },
    threads: listThreads,
    async stop({ force, detach }) {
      if (!force && !detach) {
        const working = (await listThreads()).filter(
          (t) => t.state === "working",
        );
        if (working.length)
          throw new Error(
            `${working.length === 1 ? "A thread is" : `${working.length} threads are`} still working: ${working
              .map((t) => `“${t.title}”`)
              .join(
                ", ",
              )}. Stop with --force to end them, or restart to keep them going.`,
          );
      }
      // Answered first; the socket closes as Relay goes.
      setTimeout(() => void shutDown(!!detach), 50);
    },
    async cursorSignIn() {
      if (cursorLogin?.status === "waiting" && cursorLogin.url)
        return { ...cursorLogin };
      const login: CursorLogin = { status: "waiting" };
      cursorLogin = login;
      await new Promise<void>((resolve, reject) => {
        signInCursor((url) => {
          login.url = url;
          resolve();
        }).then(
          () => {
            login.status = "done";
            void agentUpdates.check(true);
            resolve();
          },
          (e) => {
            login.status = "failed";
            login.error = e instanceof Error ? e.message : String(e);
            reject(e);
          },
        );
      });
      return { ...login };
    },
    cursorSignInState: async () => (cursorLogin ? { ...cursorLogin } : null),
    async cursorSignOut() {
      cursorLogin = undefined;
      await signOutCursor();
      await agentUpdates.check(true);
    },
    speech: async () => speech.state(),
    installSpeech: async (engine, voice) => speech.install(engine, voice),
    removeSpeech: (engine, voice) => speech.remove(engine, voice),
    call: (method, args) =>
      dispatch(method as Parameters<Dispatch>[0], args.slice(0, 10)),
  };
  control = await serveControl(paths.control, controlApi);
  const state = await remote.state();
  console.log(
    `Relay ${headlessVersion} is running (pid ${process.pid}, data in ${home}).`,
  );
  console.log(
    state.listening
      ? `Phones and computers reach it at ${state.hosts.join(", ")}:${state.port}.`
      : `Not reachable yet: ${state.error ?? "waiting for Tailscale."}`,
  );
}

function threadRow(chat: ChatSummary, project: string): ThreadRow {
  const state: ThreadRow["state"] = chat.sentTo
    ? "away"
    : chat.running
      ? "working"
      : chat.waiting
        ? "waiting"
        : chat.settledAt || chat.archivedAt
          ? "settled"
          : "idle";
  return {
    id: chat.id,
    projectId: chat.projectId,
    project,
    title: chat.title,
    ...(chat.provider ? { provider: chat.provider } : {}),
    state,
    updated: chat.updated,
    ...(chat.branch ? { branch: chat.branch } : {}),
    ...(chat.sentTo
      ? { computer: chat.sentTo.computer }
      : chat.cameFrom && !chat.cameFrom.returnedAt
        ? { computer: chat.cameFrom.computer }
        : {}),
  };
}
