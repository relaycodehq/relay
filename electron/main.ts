import { app, dialog, net } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { roomProtocol } from "../shared/rooms";
import { AgentHosts } from "./agent-host/client";
import { AgentUpdates, machineIo } from "./agent-updates";
import { hostAgents } from "./agents";
import { cursorSdkIo } from "./agents/cursor/account";
import { configureCursor } from "./agents/cursor/sdk";
import { apiContext } from "./api/context";
import { createDispatch, serveApi, type Dispatch } from "./api";
import { AppLinks } from "./app/links";
import { GiteaLogin, seal, unseal } from "./app/login";
import { setApplicationMenu } from "./app/menu";
import { Menubar } from "./app/menubar";
import { Quit } from "./app/quit";
import { AppWindow } from "./app/window";
import { BlameService } from "./blame";
import { Ci } from "./ci";
import { ProjectChecks } from "./checks/service";
import { DevOps } from "./plugins/devops/service";
import { ClockifyPlugin } from "./plugins/clockify/service";
import { PluginSecrets } from "./plugins/secrets";
import { Dictation } from "./dictation/service";
import { gitExecutable, setGitPath } from "./git";
import { registerAppImage } from "./linux-desktop-entry";
import { linuxPasswordStore } from "./linux-password-store";
import { LiveSyncs } from "./live-sync";
import { ProjectChats } from "./project-chats";
import { ChatSummaryFeed } from "./chat-summaries";
import { ProjectSharing } from "./project-sharing";
import { Projects } from "./projects";
import { PullRequestCreation } from "./pull-request-create";
import { questionContext } from "./questions";
import { PhoneAppFiles } from "./remote/phone-app";
import { PhoneRemote } from "./remote/phone-remote";
import { Computers } from "./handoff/computers";
import { HandoffReceiver } from "./handoff/receiver";
import { Handoffs } from "./handoff/sender";
import { readHostingSetup } from "./rooms/provision";
import { RoomService } from "./rooms/service";
import { pathReady } from "./shell-path";
import { setLinkedAgents } from "./executables";
import { applyLinkedTools } from "./source-control";
import { Store } from "./store";
import { projectTasks } from "./tasks";
import { threadTerminals } from "./thread-terminals";
import { TriageService } from "./triage/service";
import { Updater } from "./updater";
import { keepUsageHistory } from "./usage-history";
import { flushWorkingFiles } from "./working-files";
import { flushGitOperations } from "./working-tree";
// The name is also the instance lock and the OS credential namespace; set it before
// Electron initializes Keychain, and restore the display name once ready.
app.setName("Relay Experimental");
if (!process.env.RELAY_TEST_DATA)
  app.setPath("userData", join(app.getPath("appData"), "Relay Experimental"));
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
let rooms: RoomService | undefined;
let projectChats: ProjectChats | undefined;
let triage: TriageService | undefined;
let phoneRemote: PhoneRemote | undefined;
/** Handing threads to other computers running Relay. */
let handoffs: { computers: Computers; sender: Handoffs } | undefined;
/** Where the agents' sessions run, so they outlive a restart of Relay. */
let agentHosts: AgentHosts | undefined;
const login = new GiteaLogin();
const window = new AppWindow({
  closed: () => {
    blame.dispose();
    projectChecks.stop();
  },
  rendererGone: () => projectChecks.stop(),
});
const menubar = new Menubar(
  () => window.open(),
  () => projectChats?.working() ?? 0,
);
const quit = new Quit({
  window,
  started: () => !!store,
  runningTasks: () => projectChats?.runningTasks() ?? [],
  stopping: () => triage?.cancel(),
  shutDown: () =>
    liveSyncs
      .stopAll()
      .then(() => phoneRemote?.close())
      .then(() => handoffs?.computers.close())
      .then(() => {
        if (quit.detaching) agentHosts?.detach();
        return projectChats?.dispose({ detach: quit.detaching });
      })
      .then(() => rooms?.dispose())
      .then(() =>
        Promise.all([
          store!.flush(),
          flushWorkingFiles(),
          flushGitOperations(),
        ]),
      ),
  release: () => {
    menubar.destroy();
    threadTerminals.closeAll();
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
const dictation = new Dictation(app.getPath("userData"), (state) =>
  window.send("relay:dictation", state),
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
const liveSyncs = new LiveSyncs(() =>
  join(app.getPath("userData"), "live-sync"),
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
const hostingSetup = process.argv.includes("--configure-room-hosting-stdin")
  ? readHostingSetup(process.stdin).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
  : null;
if (!app.requestSingleInstanceLock()) {
  if (hostingSetup) {
    console.error("Close Relay before configuring hosting.");
    app.exit(1);
  } else app.quit();
}
const links = new AppLinks(window, () => !!login.client);
links.listen();
quit.listen();
app
  .whenReady()
  .then(async () => {
    app.setName("Relay");
    quit.detachOnSignals();
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
    setGitPath(loaded.get().gitPath ?? null);
    setLinkedAgents(loaded.get().agentPaths ?? {});
    applyLinkedTools(loaded);
    // Found once up front, every Git call after starts right away.
    void gitExecutable().catch(() => {});
    const projects = new Projects(loaded);
    const roomService = new RoomService(
      loaded,
      (url, init) => net.fetch(url, init),
      seal,
      unseal,
    );
    rooms = roomService;
    const devops = new DevOps(
      loaded,
      (url, init) => net.fetch(url, init),
      seal,
      unseal,
      join(app.getPath("userData"), "devops-relevance.json"),
    );
    keepUsageHistory(join(app.getPath("userData"), "usage-history.json"));
    const chats = new ProjectChats(
      loaded,
      projects,
      join(app.getPath("userData"), "project-chats"),
      (event) => {
        window.send("relay:project-chat", event);
        phoneRemote?.chatEvent(event);
      },
      new ProjectSharing(projects, roomService, () => login.require()),
      async (chat, selection) => {
        if (chat.scope.kind !== "pr")
          throw new Error("This is not a pull request conversation.");
        const client = login.require(),
          repo = await projects.linked(chat.projectId, client);
        if (
          repo.owner !== chat.scope.ref.owner ||
          repo.name !== chat.scope.ref.name
        )
          throw new Error("The selected PR does not match this project.");
        return questionContext(client, chat.scope.ref, selection);
      },
    );
    projectChats = chats;
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
    if (hostingSetup) {
      const input = await hostingSetup;
      if ("error" in input) throw input.error;
      await roomService.saveHosting(input.value);
      await loaded.flush();
      console.log("Shared-room hosting access saved securely.");
      quit.ready = true;
      app.quit();
      return;
    }
    const triageService = new TriageService(loaded, app.getPath("userData"));
    triage = triageService;
    const api = apiContext({
      store: loaded,
      projects,
      projectChats: chats,
      rooms: roomService,
      devops,
      clockify,
      triage: triageService,
      phoneRemote: () => phoneRemote,
      handoffs: () => handoffs,
      login,
      window,
      menubar,
      links,
      projectChecks,
      blame,
      ci,
      liveSyncs,
      pullRequestCreation,
      updater,
      dictation,
      agentUpdates,
    });
    const dispatch: Dispatch = createDispatch(api);
    const summaries = new ChatSummaryFeed(api.listChats, (event) => {
      window.send("relay:project-chats", event);
      phoneRemote?.chatsEvent(event);
    });
    chats.onSummaries((projectId) => {
      summaries.changed(projectId);
      menubar.refresh();
    });
    // Whether a PR thread's review began reads with the account.
    login.changed = () => chats.summariesChanged();
    // A quiet thread settles itself as days pass; the feed sends only what changed.
    setInterval(() => chats.summariesChanged(), 5 * 60_000).unref();
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
        dictation: {
          status: () => dictation.current.status,
          open: () => dictation.open(),
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
    chats.armWakeups();
    updater.start();
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
    // Use a dedicated invitation scheme; stable PR links keep their existing handler.
    if (app.isPackaged) app.setAsDefaultProtocolClient(roomProtocol);
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
    if (hostingSetup) {
      console.error(
        "Hosting setup failed. Check the server, setup key and Keychain access.",
      );
      app.exit(1);
      return;
    }
    dialog.showErrorBox("Relay could not start", e.message);
    app.quit();
  });
