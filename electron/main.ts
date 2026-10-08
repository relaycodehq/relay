import { app, dialog, net, powerMonitor } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AgentHosts } from "./agent-host/client";
import { AgentUpdates, machineIo } from "./agents/agent-updates";
import { hostAgents, setOpenCodeEnvRoot } from "./agents";
import { cursorSdkIo } from "./agents/cursor/account";
import { configureCursor } from "./agents/cursor/sdk";
import { apiContext } from "./api/context";
import { createDispatch, serveApi, type Dispatch } from "./api";
import { AppLinks } from "./app/links";
import { GiteaLogin, seal, unseal } from "./app/login";
import { GithubLogin } from "./pull-requests/github-login";
import type { Repo } from "../shared/types";
import { isGithubServer } from "../shared/source-control";
import { setApplicationMenu } from "./app/menu";
import { Menubar } from "./app/menubar";
import { KeepAwake } from "./app/keep-awake";
import { startLog } from "./app/log";
import { Quit } from "./app/quit";
import { rearmOnWake } from "./app/wake";
import { AppWindow } from "./app/window";
import {
  offerCrashReport,
  offerWindowReport,
  watchForCrashes,
  type LastRun,
} from "./bug-report";
import { BlameService } from "./git/blame";
import { Ci } from "./ci";
import { ProjectChecks } from "./checks/service";
import { DevOps } from "./plugins/devops/service";
import { ClockifyPlugin } from "./plugins/clockify/service";
import { PluginSecrets } from "./plugins/secrets";
import { Dictation } from "./dictation/service";
import { ReadAloud } from "./read-aloud";
import { gitExecutable, setGitPath } from "./git/git";
import { registerAppImage } from "./platform/linux-desktop-entry";
import { linuxPasswordStore } from "./platform/linux-password-store";
import { ProjectChats } from "./project-chats";
import {
  lookAtPage,
  registerRenderScheme,
  serveRenders,
} from "./html-renders";
import {
  agentProjects,
  answerRelayTools,
  prepareRelayTools,
} from "./started-threads/serve";
import { ChatSummaryFeed } from "./project-chats/chat-summaries";
import { PullMerges } from "./project-chats/pull-merges";
import { Projects, repositoryRoot } from "./projects/projects";
import { projectForFolder } from "./app/open-folder";
import { mergedPulls } from "./pull-requests/merged";
import { PullRequestCreation } from "./pull-requests/pull-request-create";
import { questionContext } from "./pull-requests/questions";
import { PhoneAppFiles } from "./remote/phone-app";
import { PhoneRemote } from "./remote/phone-remote";
import { shrinkImage } from "./remote/shrink-image";
import { Computers } from "./handoff/computers";
import { HandoffReceiver } from "./handoff/receiver";
import { Handoffs } from "./handoff/sender";
import { pathReady } from "./platform/shell-path";
import { setLinkedAgents } from "./platform/executables";
import { applyLinkedTools } from "./source-control";
import { Store } from "./app/store";
import { projectTasks } from "./terminal/tasks";
import { threadTerminals } from "./terminal/thread-terminals";
import { TriageService } from "./triage/service";
import { Updater } from "./app/updater";
import { DevBuild } from "./app/dev-build";
import { listenDevSwitch } from "./app/dev-switch";
import { keepUsageHistory } from "./agents/usage-history";
import { keepUsageLog } from "./usage";
import {
  AgentAccounts,
  accountHomes,
  setProfilesRoot,
} from "./agents/accounts";
import { ProjectAdding } from "./project-add";
import { TerminalSessions } from "./terminal-sessions";
import { flushWorkingFiles } from "./git/working-files";
import { flushGitOperations } from "./git/working-tree";
import {
  ThreadPreviews,
  PreviewProjects,
  ServerLinks,
  worktreeDevPort,
} from "./preview";
// The name is also the instance lock and the OS credential namespace; set it before
// Electron initializes Keychain, and restore the display name once ready.
app.setName("Relay Experimental");
if (!process.env.RELAY_TEST_DATA)
  app.setPath("userData", join(app.getPath("appData"), "Relay Experimental"));
// One place on every platform, beside the rest of Relay's data.
app.setAppLogsPath(join(app.getPath("userData"), "logs"));
startLog(app.getPath("logs"), app.getVersion());
if (
  process.platform === "linux" &&
  !app.commandLine.hasSwitch("password-store")
) {
  const store = linuxPasswordStore(process.env);
  if (store) app.commandLine.appendSwitch("password-store", store);
}
// Started this early, the login shell has usually answered before the first
// CLI lookup waits for it.
void pathReady();
let store: Store | undefined;
let projectChats: ProjectChats | undefined;
/** The threads' browsers; unset until Relay has started. */
let previews: ThreadPreviews | undefined;
let triage: TriageService | undefined;
let phoneRemote: PhoneRemote | undefined;
/** Handing threads to other computers running Relay. */
let handoffs: { computers: Computers; sender: Handoffs } | undefined;
/** Where the agents' sessions run, so they outlive a restart of Relay. */
let agentHosts: AgentHosts | undefined;
const login = new GiteaLogin();
const github = new GithubLogin((url, options) => net.fetch(url, options));
/** The client for a project's repository host; null when it has none Relay can use. */
const window = new AppWindow({
  quitCancelled: () => quit.cancel(),
  closed: () => {
    previews?.hideAll();
    blame.dispose();
    projectChecks.stop();
  },
  reloaded: () => previews?.hideAll(),
  rendererGone: (details) => {
    projectChecks.stop();
    if (window.win) void offerWindowReport(window.win, details);
  },
});
const menubar = new Menubar(
  () => window.open(),
  () => projectChats?.working() ?? 0,
);
const keepAwake = new KeepAwake({
  enabled: () => store?.get().keepAwake ?? true,
  busy: () =>
    (projectChats?.working() ?? 0) > 0 || !!phoneRemote?.expectsCalls(),
});
const quit = new Quit({
  window,
  started: () => !!store,
  runningTasks: () => projectChats?.runningTasks() ?? [],
  prepare: async () => {
    await Promise.all([flushWorkingFiles(), flushGitOperations()]);
    await projectChats?.prepareToQuit({ detach: quit.detaching });
    await store!.flush();
  },
  cancelled: () => projectChats?.resumeAfterCancelledQuit(),
  stopping: () => triage?.cancel(),
  shutDown: async () => {
    const closed = await Promise.allSettled([
      Promise.resolve().then(() => phoneRemote?.close()),
      Promise.resolve().then(() => handoffs?.computers.close()),
    ]);
    for (const result of closed)
      if (result.status === "rejected")
        console.warn("Could not close a remote service:", result.reason);
    await projectChats?.dispose({ detach: quit.detaching, save: false });
    if (quit.detaching) agentHosts?.detach();
  },
  release: () => {
    menubar.destroy();
    keepAwake.dispose();
    threadTerminals.closeAll();
    previews?.dispose();
    blame.dispose();
    login.client?.dispose();
  },
});
const pullRequestCreation = new PullRequestCreation();
const updater = new Updater((state) => window.send("relay:update", state), {
  // The agent host keeps the agents' work going across the restart.
  runningTasks: () =>
    agentHosts ? 0 : (projectChats?.runningTasks().length ?? 0),
  // Restarting for an update was the user's call, tasks or not.
  beforeQuit: () => {
    quit.confirmed = true;
    quit.detaching = true;
  },
});
const devBuild = new DevBuild(
  (stale) => window.send("relay:dev-build", stale),
  {
    quit: (cancelled) => quit.restart(cancelled),
  },
);
const dictation = new Dictation(app.getPath("userData"), (state) =>
  window.send("relay:dictation", state),
);
const readAloud = new ReadAloud(
  app.getPath("userData"),
  {
    get: () => store?.get().readAloud,
    save: async (settings) => {
      if (!store) throw new Error("Relay is still starting.");
      await store.update((s) => {
        s.readAloud = settings;
      });
    },
  },
  (state) => window.send("relay:read-aloud-state", state),
);
// Cursor's SDK isn't shipped: Relay downloads it into its data folder, and
// runs it in a worker that, like the agent host, Node must read outside the asar.
configureCursor({
  worker: join(__dirname, "cursor-worker.mjs").replace(
    /app\.asar([\\/])/,
    "app.asar.unpacked$1",
  ),
  root: join(app.getPath("userData"), "cursor-sdk"),
  store: join(app.getPath("userData"), "cursor-agents"),
  fetch: (url, init) => net.fetch(url, init),
});
const agentUpdates = new AgentUpdates(
  (state) => window.send("relay:agent-updates", state),
  {
    ...machineIo,
    fetch: (url, init) => net.fetch(url, init),
    cursor: cursorSdkIo,
  },
);
// The worker runs under the system Node.js, which cannot read inside app.asar.
const projectChecks = new ProjectChecks(
  join(__dirname, "checks-worker.mjs"),
  join(__dirname, "typescript-5", "lib", "typescript.js").replace(
    /app\.asar([\\/])/,
    "app.asar.unpacked$1",
  ),
);
const blame = new BlameService();
const ci = new Ci((url, init) => net.fetch(url, init));
let lastRun: LastRun | null = null;
if (!app.requestSingleInstanceLock()) app.quit();
else lastRun = watchForCrashes();
const links = new AppLinks(window, () => !!login.client);
links.listen();
quit.listen();
registerRenderScheme();
app
  .whenReady()
  .then(async () => {
    app.setName("Relay");
    quit.detachOnSignals();
    if (lastRun) await offerCrashReport(lastRun);
    const loaded = new Store(app.getPath("userData"));
    store = loaded;
    await loaded.load();
    // The host runs from a plain file: Node can't start a module inside app.asar.
    const hostScript = join(__dirname, "agent-host.mjs").replace(
      /app\.asar([\\/])/,
      "app.asar.unpacked$1",
    );
    if (existsSync(hostScript)) {
      const hosts = new AgentHosts(
        join(app.getPath("userData"), "agent-host"),
        hostScript,
      );
      agentHosts = hosts;
      hostAgents(hosts);
      projectTasks.hosts = () => hosts.pids();
    }
    // Before any agent session starts, so each gets the tools.
    const relayTools = await prepareRelayTools(
      join(app.getPath("userData"), "agent-host"),
    );
    setGitPath(loaded.get().gitPath ?? null);
    setLinkedAgents(loaded.get().agentPaths ?? {});
    setProfilesRoot(join(app.getPath("userData"), "agent-accounts"));
    setOpenCodeEnvRoot(join(app.getPath("userData"), "opencode"));
    // Before anything starts an agent: runs ask it which account they use.
    const agentAccounts = new AgentAccounts(loaded, (state) =>
      window.send("relay:agent-accounts", state),
    );
    applyLinkedTools(loaded);
    // Found once up front, every Git call after starts right away.
    void gitExecutable().catch(() => {});
    const projects = new Projects(loaded);
    links.onFolder((folder) => {
      void projectForFolder(folder, {
        list: () => projects.list(login.client),
        add: (root) => projects.add(root, login.client),
        repositoryRoot,
      })
        .then((found) => {
          if ("project" in found) return links.openProject(found.project.id);
          void dialog.showMessageBox({
            type: "info",
            message: "Relay can't open that folder",
            detail: found.refused,
          });
        })
        .catch((e) => console.warn("Could not open", folder, e));
    });
    const hostOf = async (repo: Repo) =>
      isGithubServer(repo.server) ? github.require() : login.require();
    async function projectHost(projectId: string) {
      const repository = projects.get(projectId).repository;
      if (!repository) return null;
      return isGithubServer(repository.server)
        ? github.require()
        : login.client;
    }
    const devops = new DevOps(
      loaded,
      (url, init) => net.fetch(url, init),
      seal,
      unseal,
      join(app.getPath("userData"), "devops-relevance.json"),
    );
    keepUsageHistory(join(app.getPath("userData"), "usage-history.json"));
    keepUsageLog(join(app.getPath("userData"), "usage.jsonl"));
    const chats = new ProjectChats(
      loaded,
      projects,
      join(app.getPath("userData"), "project-chats"),
      (event) => {
        window.send("relay:project-chat", event);
        phoneRemote?.chatEvent(event);
      },
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
    projectChats = chats;
    serveRenders((chatId, renderId, page) =>
      chats.renderPage(chatId, renderId, page),
    );
    const pullMerges = new PullMerges({
      chats: () => loaded.get().chats ?? [],
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
      online: () => net.isOnline(),
    });
    const clockify = new ClockifyPlugin({
      store: loaded,
      secrets: new PluginSecrets(loaded, seal, unseal),
      fetch: (url, init) => net.fetch(url, init),
      chats: {
        summaries: () => loaded.get().chats ?? [],
        get: (id) => chats.get(id),
      },
      projectName: (id) => {
        try {
          return projects.get(id).name;
        } catch {
          return "Removed project";
        }
      },
      aiSettings: () => loaded.aiSettings(),
    });
    const triageService = new TriageService(loaded, app.getPath("userData"));
    triage = triageService;
    const previewProjects = new PreviewProjects(
      projects,
      chats,
      () => loaded.get().chats ?? [],
    );
    previews = new ThreadPreviews(window, (projectId, chatId, url, folder) =>
      previewProjects.target(projectId, chatId, url, serverLinks, folder),
    );
    const serverLinks = new ServerLinks(
      previews.external,
      (chat) => previewProjects.folders(chat),
      async (chat, folder, port) => {
        const settings = projects.get(chat.projectId).settings;
        if (!settings?.devCommand || !settings.devPort) return;
        const env = await previewProjects.env(chat, folder);
        if (port !== worktreeDevPort(settings.devPort, env)) return;
        return previews?.servers.ensure(folder, settings.devCommand, port, env);
      },
    );
    chats.setPreviewLinks(serverLinks);
    const api = apiContext({
      store: loaded,
      projects,
      projectChats: chats,
      pullMerges,
      devops,
      clockify,
      triage: triageService,
      phoneRemote: () => phoneRemote,
      handoffs: () => handoffs,
      login,
      github,
      window,
      menubar,
      links,
      projectChecks,
      blame,
      ci,
      pullRequestCreation,
      updater,
      devBuild,
      dictation,
      readAloud,
      agentUpdates,
      agentAccounts,
      projectAdding: new ProjectAdding({
        store: loaded,
        projects,
        client: () => login.client,
        sessions: new TerminalSessions(async () => accountHomes()),
        appData: app.getPath("appData"),
        send: (job) => window.send("relay:project-adding", job),
      }),
      previews,
    });
    const dispatch: Dispatch = createDispatch(api);
    const summaries = new ChatSummaryFeed(api.listChats, (event) => {
      window.send("relay:project-chats", event);
      phoneRemote?.chatsEvent(event);
    });
    chats.onSummaries((projectId) => {
      summaries.changed(projectId);
      menubar.refresh();
      void keepAwake.refresh();
    });
    // Settings, phone access and the power source change without a thread noticing.
    setInterval(() => void keepAwake.refresh(), 15_000).unref();
    // Whether a PR thread's review began reads with the account.
    login.changed = () => {
      chats.summariesChanged();
      void pullMerges.sweep();
    };
    // A quiet thread settles itself as days pass, and one whose PR merged when
    // the host says so; the feed sends only what changed.
    setInterval(() => {
      chats.summariesChanged();
      void pullMerges.sweep();
      void chats.cleanUpWorktrees();
    }, 5 * 60_000).unref();
    // Not right at launch: the thread the window opens on first says it's shown.
    setTimeout(() => void chats.cleanUpWorktrees(), 60_000).unref();
    const handoffDir = join(app.getPath("userData"), "handoffs");
    const computers = new Computers(loaded, seal, unseal);
    handoffs = {
      computers,
      sender: new Handoffs(
        loaded,
        computers,
        chats,
        projects,
        join(handoffDir, "out"),
      ),
    };
    phoneRemote = new PhoneRemote(
      loaded,
      seal,
      unseal,
      {
        projects: () => projects.list(login.client),
        projectPath: (id) => projects.get(id).path,
        chats: api.listChats,
        chat: (id, known) => (known ? chats.changes(id, known) : chats.get(id)),
        version: () => app.getVersion(),
        // The bridge forwards only its allowlist; see shared/remote.ts.
        dispatch,
        phoneApp: new PhoneAppFiles(join(__dirname, "../dist-phone")),
        shrinkImage,
        dictation: {
          status: () => dictation.current.status,
          open: () => dictation.open(),
        },
        readAloud: {
          ready: () => readAloud.ready(),
          speak: (markdown, sink) => readAloud.speak(markdown, sink),
        },
        handoffs: new HandoffReceiver({
          projects: () => projects.list(login.client),
          root: (id) => projects.root(id),
          chats,
          worktrees: join(app.getPath("userData"), "worktrees"),
          dir: join(handoffDir, "in"),
          version: () => app.getVersion(),
          updates: {
            state: () => updater.current,
            check: () => updater.check(),
            download: () => updater.download(),
            install: () => updater.installAndRestart(),
          },
        }),
      },
      Number(process.env.RELAY_REMOTE_PORT) || undefined,
    );
    void phoneRemote.start();
    void computers.start();
    threadTerminals.connect((event) => window.send("relay:terminal", event));
    serveApi(window, dispatch);
    // Agent sessions that kept running through a restart come back before the window does.
    await chats.reattach();
    if (relayTools)
      void answerRelayTools(
        relayTools,
        chats,
        agentHosts,
        agentProjects(projects, () => login.client, app.getPath("userData")),
        previews,
        lookAtPage,
      );
    chats.armWakeups();
    void chats
      .reconcileSummaries()
      .catch((e) => console.warn("Could not reconcile thread summaries:", e));
    rearmOnWake(powerMonitor, () => chats.armWakeups());
    updater.start();
    devBuild.start();
    listenDevSwitch(quit);
    // Tests' stand-in agents only answer what a test expects of them.
    if (!process.env.RELAY_TEST_DATA) agentUpdates.start();
    setApplicationMenu(window);
    if (app.isPackaged && process.platform === "linux" && process.env.APPIMAGE)
      registerAppImage({
        appImage: process.env.APPIMAGE,
        iconSource: join(app.getAppPath(), "assets/icon.png"),
        iconDir: app.getPath("userData"),
        env: process.env,
      });
    window.ready = true;
    // Test runs stay off the user's menubar, as their windows stay off the desktop.
    if (!process.env.RELAY_TEST_DATA || process.env.RELAY_TEST_HEADED === "1")
      menubar.start();
    window.create();
    void login.restoreSaved(loaded);
    app.on("activate", () => {
      if (!window.win) window.create();
      else window.show();
    });
  })
  .catch((e) => {
    dialog.showErrorBox("Relay could not start", e.message);
    app.quit();
  });
