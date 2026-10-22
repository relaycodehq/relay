// Relay without its window: the desktop's own services, started the way
// electron/main.ts starts them, for a computer that's only ever reached from
// a phone or another computer. The `relay` command talks to it through
// ./control; phones and computers through the same bridge as the desktop's.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { rm } from "node:fs/promises";
import type { Server } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { watchSavedSignIns } from "../agents";
import { AgentUpdates, machineIo } from "../agents/agent-updates";
import { cursorSdkIo } from "../agents/cursor/account";
import { antigravityIo, registryUpdatesIo } from "../agents/acp";
import { createDispatch, type Dispatch } from "../api";
import { apiContext } from "../api/context";
import { DevBuild } from "../app/dev-build";
import { KeepAwake } from "../app/keep-awake";
import { AppLinks } from "../app/links";
import { GiteaLogin } from "../app/login";
import { Menubar } from "../app/menubar";
import { Store } from "../app/store";
import { Updater } from "../app/updater";
import { DailyPing } from "../app/daily-ping";
import { AppWindow } from "../app/window";
import { ProjectChecks } from "../checks/service";
import { Ci } from "../ci";
import { Dictation } from "../dictation/service";
import { BlameService } from "../git/blame";
import { flushWorkingFiles } from "../git/working-files";
import { flushGitOperations } from "../git/working-tree";
import { setComputerName } from "../platform/computer-name";
import { finishPath, pathReady } from "../platform/shell-path";
import { ProjectAdding } from "../project-add";
import { GithubLogin } from "../github";
import { PullRequestCreation } from "../pull-requests/pull-request-create";
import { ReadAloud } from "../read-aloud";
import { setOnnxRuntimeDir } from "../util/onnxruntime";
import { PhoneRemote } from "../remote/phone-remote";
import { DraftStore, Drafts } from "../drafts";
import { teaTokenFor } from "../source-control";
import { TriageService } from "../triage/service";
import { serveControl } from "./control";
import { onAppQuit, powerMonitor } from "./electron-stand-in";
import { openSettingsFile, readPrefs } from "../settings";
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
import {
  agentHost,
  downloadedAgents,
  followSummaries,
  prepareData,
  remoteServices,
  resumeThreads,
  threadServices,
} from "../startup";
import { controlApi } from "./control-api";

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

/**
 * The Node the daemon runs on goes first on its PATH when the one there is
 * missing or older than the agent CLIs take (Ubuntu 22.04's is 12): the npm
 * that installs agents into agent-clis, and the `#!/usr/bin/env node` CLIs it
 * puts there, run on it then. A Node the user has that is new enough, nvm's
 * say, stays first, so their projects' tasks and terminals keep it.
 */
async function preferOwnNode(env: NodeJS.ProcessEnv) {
  const version = await promisify(execFile)("node", ["--version"], {
    env,
    timeout: 5000,
  }).then(
    ({ stdout }) => stdout,
    () => "",
  );
  if (Number(/^v(\d+)\./.exec(version.trim())?.[1] ?? 0) >= 18) return;
  env.PATH = [dirname(process.execPath), env.PATH]
    .filter(Boolean)
    .join(delimiter);
}

/** Starts everything and resolves once Relay is answering; exits the process when stopped. */
export async function runDaemon({ home, port, name }: DaemonOptions) {
  finishPath(preferOwnNode);
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
  // `relay settings` changes it through the API; a script or an editor may too.
  const settingsFile = await openSettingsFile({
    store,
    data: home,
    home: homedir(),
    appData: process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
    changed: () => {
      void keepAwake.refresh();
      chats.summariesChanged();
    },
  });
  let phoneRemote: PhoneRemote | undefined;
  // Only phones write drafts here: with no page, nothing holds a part of one.
  const draftStore = new DraftStore(join(home, "drafts.json"));
  await draftStore.load();
  const drafts = new Drafts(draftStore, {
    changed: (change) => phoneRemote?.draftChanged(change),
  });
  let handoffs: ReturnType<typeof remoteServices>["handoffs"] | undefined;
  const { hosts: agentHosts, tools: relayTools } = await agentHost(
    home,
    // The host runs from a plain file beside this one.
    join(__dirname, "agent-host.mjs"),
  );
  const acpAgents = downloadedAgents(
    home,
    fetcher,
    join(__dirname, "cursor-worker.mjs"),
  );
  const agentAccounts = await prepareData(home, store, () =>
    watchSavedSignIns(),
  );
  const login = new GiteaLogin(teaTokenFor);
  const github = new GithubLogin(fetcher);
  const { projects, pullHosts, devops, chats, pullMerges, clockify } =
    threadServices({
      dir: home,
      store,
      fetch: fetcher,
      login,
      github,
      online: () => true,
      chatEvent: (event) => phoneRemote?.chatEvent(event),
      prefs: () => readPrefs(settingsFile.state().values),
    });
  chats.onNews((item) => phoneRemote?.news(item));
  const keepAwake = new KeepAwake(
    {
      enabled: () => readPrefs(settingsFile.state().values).keepAwake,
      busy: () => chats.working() > 0 || !!phoneRemote?.expectsCalls(),
    },
    headlessPower(),
  );
  // What its changes reach exists from here.
  settingsFile.follow();
  // The window's services, built so the dispatch has them; with no window
  // they never open one, and what they'd show goes nowhere.
  // Speech for phones, its engines downloaded into the home folder when set up.
  const runtime = new SpeechRuntime(home, __dirname, fetcher);
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
    pageGone: () => {},
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
  const projectAdding = new ProjectAdding({
    store,
    projects,
    client: () => login.client,
    send: () => {},
  });
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
    hosts: pullHosts.hosts,
    window,
    menubar: new Menubar(
      () => {},
      () => chats.working(),
    ),
    links: new AppLinks(window, () => !!login.client),
    projectChecks: new ProjectChecks(join(__dirname, "checks-worker.mjs")),
    blame: new BlameService(),
    ci: new Ci(fetcher, github.credentials),
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
    projectAdding,
    drafts,
    settingsFile,
  });
  const dispatch: Dispatch = createDispatch(api);
  followSummaries({
    chats,
    listChats: api.listChats,
    pullMerges,
    login,
    keepAwake,
    send: (event) => phoneRemote?.chatsEvent(event),
  });
  const updater = new HeadlessUpdater(installRoot(__dirname), headlessVersion, {
    restart: () => {
      setTimeout(() => void shutDown(true, { restart: true }), 50);
    },
  });
  const remoteSide = remoteServices({
    dir: home,
    store,
    projects,
    chats,
    login,
    listChats: api.listChats,
    dispatch,
    adding: projectAdding,
    version: () => headlessVersion,
    // A paired computer or phone may update this one, as on the desktop.
    updates: {
      state: () => updater.now,
      check: () => updater.check(),
      download: () => updater.download(),
      install: () => updater.install(),
    },
    host: {
      // Images go to phones whole, re-encoded smaller where that's possible.
      shrinkImage: (dataUrl) => compressImage(dataUrl),
      drafts,
      dictation: speech.forPhones.dictation,
      readAloud: speech.forPhones.readAloud,
    },
    port,
  });
  handoffs = remoteSide.handoffs;
  const { receiver, phoneRemote: remote } = remoteSide;
  const { computers } = handoffs;
  phoneRemote = remote;
  // Default phone access on once, even if Tailscale isn't available yet.
  // start() watches for it; an explicitly saved false remains false.
  await remote.start(true);
  void computers.start();
  await resumeThreads({
    dir: home,
    chats,
    projects,
    login,
    agentHosts,
    relayTools,
    agentUpdates,
    aiSettings: () => store.aiSettings(),
    tools: { handoffs: handoffs.sender },
    powerMonitor,
  });
  new DailyPing({
    kind: "headless",
    version: headlessVersion,
    live: updater.now.status !== "off" && !process.env.RELAY_TEST_DATA,
    enabled: () => readPrefs(settingsFile.state().values).usagePing,
    store,
  }).start();
  if (!process.env.RELAY_TEST_DATA) {
    agentUpdates.start(store.get().agentUpdateChecks ?? true);
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
        computers.close({ detach });
        if (detach) agentHosts?.detach();
        await chats.dispose({ detach });
        await Promise.all([
          store.flush(),
          draftStore.flush(),
          settingsFile.flush(),
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
      if (restart) await spawnRelay(home, join(__dirname, "relay.cjs"));
      process.exit(0);
    })());
  onAppQuit(() => void shutDown(false));
  // A signal is a restart from a service manager or a script: the agents'
  // sessions carry on in the agent host and come back after it, as on the desktop.
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
    process.on(signal, () => void shutDown(true));

  control = await serveControl(
    paths.control,
    controlApi({
      home,
      startedAt,
      remote,
      projects,
      login,
      listChats: api.listChats,
      agentUpdates,
      updater,
      speech,
      dispatch,
      stop: (detach) => void shutDown(detach),
    }),
  );
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
