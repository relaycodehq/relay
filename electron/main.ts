import { app, dialog, net, powerMonitor, systemPreferences } from "electron";
import { configureOpenCodeFetch } from "./agents/opencode";
import { join } from "node:path";
import { AgentHosts } from "./agent-host/client";
import { AgentUpdates, machineIo } from "./agents/agent-updates";
import { watchSavedSignIns } from "./agents";
import { cursorSdkIo } from "./agents/cursor/account";
import { antigravityIo, registryUpdatesIo } from "./agents/acp";
import { apiContext } from "./api/context";
import { createDispatch, serveApi } from "./api";
import { serveSettingsFile } from "./api/settings-file";
import { openSettingsFile, readPrefs, type SettingsFile } from "./settings";
import { AppLinks } from "./app/links";
import { GiteaLogin } from "./app/login";
import { GithubLogin } from "./github";
import { setApplicationMenu } from "./app/menu";
import { Menubar } from "./app/menubar";
import { KeepAwake } from "./app/keep-awake";
import { startLog } from "./app/log";
import { Quit } from "./app/quit";
import { AppWindow } from "./app/window";
import { TreeWatch } from "./git/tree-watch";
import { ElsewhereWatch } from "./git/elsewhere-watch";
import { savedMainWindow, savedThreadWindows } from "../shared/thread-windows";
import {
  askAboutCrashLoop,
  offerCrashReport,
  offerWindowReport,
  draftBugReport,
  dragTray,
  reportBug,
  setUpBugReports,
  watchForCrashes,
  windowLoaded,
} from "./bug-report";
import { BlameService } from "./git/blame";
import { Ci } from "./ci";
import { ProjectChecks } from "./checks/service";
import { Dictation } from "./dictation/service";
import { ReadAloud } from "./read-aloud";
import { registerAppImage } from "./platform/linux-desktop-entry";
import { linuxPasswordStore } from "./platform/linux-password-store";
import { ProjectChats } from "./project-chats";
import { registerMediaScheme, serveMedia } from "./media";
import {
  appRenderTheme,
  lookAtPage,
  registerRenderScheme,
  serveRenders,
} from "./html-renders";
import { repositoryRoot } from "./projects/projects";
import { projectForFolder } from "./app/open-folder";
import { PullRequestCreation } from "./pull-requests/pull-request-create";
import { PhoneRemote } from "./remote/phone-remote";
import { DraftStore, Drafts } from "./drafts";
import { DraftPages } from "./drafts/pages";
import { shrinkImage } from "./remote/shrink-image";
import { Computers } from "./handoff/computers";
import { RemoteProjects } from "./handoff/remote-projects";
import { Handoffs } from "./handoff/sender";
import { WslHolders } from "./handoff/wsl-holder";
import { pathReady } from "./platform/shell-path";
import { teaTokenFor } from "./source-control";
import { Store } from "./app/store";
import { threadTerminals } from "./terminal/thread-terminals";
import { TriageService } from "./triage/service";
import { Updater } from "./app/updater";
import { DevBuild } from "./app/dev-build";
import { listenDevSwitch } from "./app/dev-switch";
import { ProjectAdding } from "./project-add";
import { MenubarSounds } from "./sounds/menubar-sounds";
import { flushWorkingFiles } from "./git/working-files";
import { flushGitOperations } from "./git/working-tree";
import { ThreadPreviews, PreviewProjects, SavedPreviews } from "./preview";
import { Devices } from "./devices";
import { Presence } from "./remote/presence";
import {
  agentHost,
  downloadedAgents,
  followSummaries,
  prepareData,
  remoteServices,
  resumeThreads,
  threadServices,
} from "./startup";
// The name is also the instance lock and the OS credential namespace; set it before
// Electron initializes Keychain, and restore the display name once ready.
app.setName("Relay Experimental");
if (!process.env.RELAY_TEST_DATA)
  app.setPath("userData", join(app.getPath("appData"), "Relay Experimental"));
// One place on every platform, beside the rest of Relay's data.
app.setAppLogsPath(join(app.getPath("userData"), "logs"));
// Specs run in the background on a real machine: silent unless one listens for sound.
if (process.env.RELAY_TEST_DATA && process.env.RELAY_TEST_SOUND !== "1")
  app.commandLine.appendSwitch("mute-audio");
startLog(app.getPath("logs"));
if (
  process.platform === "linux" &&
  !app.commandLine.hasSwitch("password-store")
) {
  const store = linuxPasswordStore(process.env);
  if (store) app.commandLine.appendSwitch("password-store", store);
}
// AppKit binds ⌃⌘←/→ to the writing-direction commands and, depending on
// input-source state, beeps at them before the page sees the key, so the
// quick switch beeped while working. Allowed, they reach the page instead.
if (process.platform === "darwin")
  systemPreferences.registerDefaults({
    NSAllowsBaseWritingDirectionKeyBindings: true,
  });
// Started this early, the login shell has usually answered before the first
// CLI lookup waits for it.
void pathReady();
let store: Store | undefined;
let settingsFile: SettingsFile | undefined;
let projectChats: ProjectChats | undefined;
/** The threads' browsers; unset until Relay has started. */
let previews: ThreadPreviews | undefined;
/** Simulators and emulators in the panel; unset until Relay has started. */
let devices: Devices | undefined;
let triage: TriageService | undefined;
let phoneRemote: PhoneRemote | undefined;
/** Unsent drafts, shared with phones; unset until Relay has started. */
let drafts: { store: DraftStore; service: Drafts } | undefined;
/** Thread sounds while the window is closed; headless Relay wires none. */
let menubarSounds: MenubarSounds | undefined;
/** Handing threads to other computers running Relay. */
let handoffs:
  | { computers: Computers; sender: Handoffs; remote: RemoteProjects }
  | undefined;
/** Where the agents' sessions run, so they outlive a restart of Relay. */
let agentHosts: AgentHosts | undefined;
/** Which working trees the windows show; unset until Relay has started. */
let treeWatch: TreeWatch | undefined;
/** Which other repositories the windows' threads changed files in; unset until Relay has started. */
let elsewhereWatch: ElsewhereWatch | undefined;
const login = new GiteaLogin(teaTokenFor);
configureOpenCodeFetch((url, options) =>
  net.fetch(url instanceof Request ? url.url : url.toString(), options),
);
const github = new GithubLogin((url, options) => net.fetch(url, options));
/** The client for a project's repository host; null when it has none Relay can use. */
const window = new AppWindow({
  quitCancelled: () => quit.cancel(),
  closed: () => {
    blame.dispose();
    projectChecks.stop();
  },
  pageGone: (win) => {
    previews?.hideAll(win);
    devices?.hideAll(win);
    treeWatch?.release(win);
    elsewhereWatch?.release(win);
    // A phone's send it was finishing goes to the page that comes next.
    if (win === window.win) drafts?.service.redeliver();
  },
  rendererGone: (details) => {
    projectChecks.stop();
    if (window.win) void offerWindowReport(window.win, details);
  },
});
/** A phone's send of a draft goes to a page; with the window closed, a hidden one. */
const draftPages = new DraftPages(window);
const menubar = new Menubar(
  () => window.open(),
  () => projectChats?.working() ?? 0,
);
const keepAwake = new KeepAwake({
  enabled: () =>
    settingsFile ? readPrefs(settingsFile.state().values).keepAwake : true,
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
    await Promise.all([
      store!.flush(),
      drafts?.store.flush(),
      settingsFile?.flush(),
    ]);
  },
  cancelled: () => projectChats?.resumeAfterCancelledQuit(),
  stopping: () => triage?.cancel(),
  shutDown: async () => {
    const closed = await Promise.allSettled([
      Promise.resolve().then(() => phoneRemote?.close()),
      Promise.resolve().then(() =>
        handoffs?.computers.close({ detach: quit.detaching }),
      ),
    ]);
    for (const result of closed)
      if (result.status === "rejected")
        console.warn("Could not close a remote service:", result.reason);
    await Promise.all([
      projectChats?.dispose({ detach: quit.detaching, save: false }),
      devices?.dispose(),
    ]);
    if (quit.detaching) agentHosts?.detach();
  },
  release: () => {
    menubar.destroy();
    draftPages.close();
    menubarSounds?.dispose();
    keepAwake.dispose();
    threadTerminals.closeAll();
    previews?.dispose({ detach: quit.detaching });
    treeWatch?.dispose();
    elsewhereWatch?.dispose();
    // Quitting before Relay finished starting skips shutDown.
    void devices?.dispose();
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
const dictation = new Dictation(
  app.getPath("userData"),
  (state) => window.send("relay:dictation", state),
  {
    get: () => store?.get().dictationEngine,
    save: async (engine) => {
      if (!store) throw new Error("Relay is still starting.");
      await store.update((s) => {
        s.dictationEngine = engine;
      });
    },
  },
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
const acpAgents = downloadedAgents(
  app.getPath("userData"),
  (url, init) => net.fetch(url, init),
  // A worker that, like the agent host, Node must read outside the asar.
  join(__dirname, "cursor-worker.mjs").replace(
    /app\.asar([\\/])/,
    "app.asar.unpacked$1",
  ),
);
const agentUpdates = new AgentUpdates(
  (state) => window.send("relay:agent-updates", state),
  {
    ...machineIo,
    fetch: (url, init) => net.fetch(url, init),
    sdks: { cursor: cursorSdkIo, antigravity: antigravityIo },
    registry: registryUpdatesIo(acpAgents),
  },
);
acpAgents.onChange((state) => {
  window.send("relay:acp-registry", state);
  void agentUpdates.sync();
});
// The worker runs under the system Node.js, which cannot read inside app.asar.
const projectChecks = new ProjectChecks(
  join(__dirname, "checks-worker.mjs"),
  join(__dirname, "typescript-5", "lib", "typescript.js").replace(
    /app\.asar([\\/])/,
    "app.asar.unpacked$1",
  ),
);
const blame = new BlameService();
const ci = new Ci((url, init) => net.fetch(url, init), github.credentials);
if (!app.requestSingleInstanceLock()) {
  // Opening Relay again only brings the running copy forward.
  console.info("Relay was opened again while already running");
  app.quit();
} else {
  console.info(`Relay ${app.getVersion()} started`);
  offerCrashReport(watchForCrashes());
}
const links = new AppLinks(window, () => !!login.client);
links.listen();
quit.listen();
registerRenderScheme();
registerMediaScheme();
app
  .whenReady()
  .then(async () => {
    app.setName("Relay");
    quit.detachOnSignals();
    const crash = await askAboutCrashLoop();
    const loaded = new Store(app.getPath("userData"));
    store = loaded;
    await loaded.load();
    // Before any window: each page asks for it as it starts.
    const file = await openSettingsFile({
      store: loaded,
      data: app.getPath("userData"),
      home: app.getPath("home"),
      appData: app.getPath("appData"),
      changed: (state) => {
        window.send("relay:settings-file", state);
        // Settings', a script's or an editor's: what the main process does with it follows.
        void keepAwake.refresh();
        projectChats?.summariesChanged();
      },
    });
    settingsFile = file;
    file.follow();
    serveSettingsFile(window, file);
    dictation.announce();
    const bugReports = setUpBugReports({
      github,
      projects: () => loaded.get().projects ?? [],
      agents: () => agentUpdates.current.agents,
      aiSettings: () => loaded.aiSettings(),
      show: () => {
        window.open();
        window.send("relay:bug-report", null);
      },
      trustHelper: (win) => window.trustHelper(win),
    });
    if (crash)
      void reportBug(crash).catch((e) =>
        console.warn("Could not open the bug report:", e),
      );
    // The main window plays its own sounds; a thread in a window of its own
    // stays quiet while that window is in front.
    menubarSounds = new MenubarSounds(
      loaded,
      (chatId) => !window.win && window.threads.state().focused !== chatId,
    );
    const dataDir = app.getPath("userData");
    const host = await agentHost(
      dataDir,
      // A plain file: Node can't start a module inside app.asar.
      join(__dirname, "agent-host.mjs").replace(
        /app\.asar([\\/])/,
        "app.asar.unpacked$1",
      ),
    );
    agentHosts = host.hosts;
    const agentAccounts = await prepareData(dataDir, loaded, (state) => {
      window.send("relay:agent-accounts", state);
      watchSavedSignIns();
    });
    const { projects, pullHosts, devops, chats, pullMerges, clockify } =
      threadServices({
        dir: dataDir,
        store: loaded,
        fetch: (url, init) => net.fetch(url, init),
        login,
        github,
        online: () => net.isOnline(),
        chatEvent: (event) => {
          window.send("relay:project-chat", event);
          phoneRemote?.chatEvent(event);
        },
        prefs: () => readPrefs(file.state().values),
      });
    projectChats = chats;
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
    links.onThread((chatId) => {
      const chat = loaded.get().chats?.find((c) => c.id === chatId);
      if (chat) window.openThread({ projectId: chat.projectId, chatId });
      else window.open();
    });
    // Apart, so one that fails doesn't keep the news from the others.
    chats.onNews((item) => window.send("relay:thread-news", item));
    chats.onNews((item) => phoneRemote?.news(item));
    chats.onNews((item) => menubarSounds?.news(item));
    serveMedia();
    serveRenders((chatId, renderId, page) =>
      chats.renderPage(chatId, renderId, page),
    );
    const triageService = new TriageService(loaded, app.getPath("userData"));
    triage = triageService;
    const previewProjects = new PreviewProjects(
      projects,
      chats,
      () => loaded.get().chats ?? [],
    );
    devices = new Devices(
      window,
      join(app.getPath("userData"), "device-hub"),
      (url, init) => net.fetch(url, init),
    );
    previews = new ThreadPreviews(
      window,
      (projectId, chatId, url, folder, saved) =>
        previewProjects.target(projectId, chatId, url, folder, saved),
      Date.now,
      new SavedPreviews(loaded),
    );
    void previews.servers.reattach();
    const draftStore = new DraftStore(
      join(app.getPath("userData"), "drafts.json"),
    );
    await draftStore.load();
    const sharedDrafts = new Drafts(draftStore, {
      changed: (change) => {
        window.send("relay:shared-draft", change);
        phoneRemote?.draftChanged(change);
      },
      deliver: (request) => draftPages.deliver(request),
    });
    drafts = { store: draftStore, service: sharedDrafts };
    treeWatch = new TreeWatch({
      root: (where) => api.placeRoot(where),
      changed: (where) => window.send("relay:working-tree", where),
    });
    elsewhereWatch = new ElsewhereWatch({
      changed: (chatId) => window.send("relay:elsewhere", chatId),
    });
    const projectAdding = new ProjectAdding({
      store: loaded,
      projects,
      client: () => login.client,
      send: (job) => window.send("relay:project-adding", job),
    });
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
      hosts: pullHosts.hosts,
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
      projectAdding,
      previews,
      devices,
      drafts: sharedDrafts,
      bugReports,
      dragTray: dragTray(),
      treeWatch,
      elsewhereWatch,
      settingsFile: file,
    });
    const dispatch = createDispatch(api);
    followSummaries({
      chats,
      listChats: api.listChats,
      pullMerges,
      login,
      keepAwake,
      send: (event) => {
        window.send("relay:project-chats", event);
        phoneRemote?.chatsEvent(event);
      },
      changed: () => menubar.refresh(),
    });
    const presence = new Presence();
    const remote = remoteServices({
      dir: dataDir,
      store: loaded,
      projects,
      chats,
      login,
      listChats: api.listChats,
      dispatch,
      adding: projectAdding,
      version: () => app.getVersion(),
      updates: {
        state: () => updater.current,
        check: () => updater.check(),
        download: () => updater.download(),
        install: () => updater.installAndRestart(),
      },
      computers: { holders: new WslHolders() },
      host: {
        present: () => presence.present(),
        shrinkImage,
        drafts: sharedDrafts,
        dictation: {
          status: () => dictation.current.status,
          open: () => dictation.open(),
        },
        readAloud: {
          ready: () => readAloud.ready(),
          speak: (markdown, sink) => readAloud.speak(markdown, sink),
        },
      },
      port: Number(process.env.RELAY_REMOTE_PORT) || undefined,
    });
    handoffs = remote.handoffs;
    phoneRemote = remote.phoneRemote;
    presence.watch(() => phoneRemote?.presenceChanged());
    void phoneRemote.start();
    void handoffs.computers.start();
    threadTerminals.connect((event) => window.send("relay:terminal", event));
    serveApi(window, dispatch);
    // Before the window comes back.
    await resumeThreads({
      dir: dataDir,
      chats,
      projects,
      login,
      agentHosts,
      relayTools: host.tools,
      agentUpdates,
      aiSettings: () => loaded.aiSettings(),
      tools: {
        previews,
        look: (html, options, signal) =>
          appRenderTheme(window.win).then((theme) =>
            lookAtPage(html, { ...options, theme }, signal),
          ),
        handoffs: handoffs.sender,
        reportProblem: draftBugReport,
        ...(process.env.RELAY_DEV_STALE
          ? { restart: () => devBuild.restart() }
          : {}),
      },
      powerMonitor,
    });
    updater.start();
    devBuild.start();
    listenDevSwitch(quit);
    // Tests' stand-in agents only answer what a test expects of them.
    if (!process.env.RELAY_TEST_DATA)
      agentUpdates.start(loaded.get().agentUpdateChecks ?? true);
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
    // Test runs park their windows off-screen and size them as each test needs.
    if (!process.env.RELAY_TEST_DATA)
      window.keepPlace({
        load: () => savedMainWindow(loaded.get().mainWindow),
        save: (place) =>
          void loaded
            .update((s) => {
              s.mainWindow = place;
            })
            .catch((e) =>
              console.warn("Could not save the window's place:", e),
            ),
      });
    window.clear = loaded.get().glass !== false;
    window.create();
    window.win?.webContents.once("did-finish-load", windowLoaded);
    window.threads.restore({
      load: () => savedThreadWindows(loaded.get().threadWindows),
      save: (windows) =>
        void loaded
          .update((s) => {
            s.threadWindows = windows;
          })
          .catch((e) => console.warn("Could not save thread windows:", e)),
      exists: ({ chatId }) =>
        !!loaded.get().chats?.some((c) => c.id === chatId),
    });
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
