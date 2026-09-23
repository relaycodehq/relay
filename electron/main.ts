import { agentResponseSchema } from "../shared/agent-modes";
import { presentSkill } from "./skill-presentation";
import { projectFolderSchema } from "../shared/project-folders";
import { codexModels, codexSkills } from "./provider-commands";
import { PullRequestCreation, branchPulls } from "./pull-request-create";
import { createPullRequestSchema } from "../shared/pull-request-create";
import { branches, changeBranch } from "./branches";
import { branchActionSchema } from "../shared/branches";
import { Projects } from "./projects";
import { ProjectSharing } from "./project-sharing";
import { ProjectChats } from "./project-chats";
import { deepReviewStartSchema } from "../shared/deep-review";
import { git } from "./git";
import {
  chatScopeSchema,
  chatTriageSchema,
  knownMessagesSchema,
  projectChatSendSchema,
  projectNameSchema,
} from "../shared/projects";
import { LiveSync } from "./live-sync";
import { idleSync } from "../shared/live-sync";
import { digest } from "./hash";
import { gitActionSchema, workingPathSchema } from "../shared/working-tree";
import {
  flushGitOperations,
  workingTree,
  workingDiff,
  performGitAction,
  validateRepo,
} from "./working-tree";
import { RoomService } from "./rooms/service";
import { readHostingSetup } from "./rooms/provision";
import {
  connectRoomSchema,
  sendRoomSchema,
  presenceSchema,
  idSchema,
  roomHostingSchema,
  roomProtocol,
  parseRoomInvitation,
} from "../shared/rooms";
import { launchLineQuestion, questionContext } from "./questions";
import { lineQuestionSchema } from "../shared/questions";
import { aiSettingsSchema, defaultAISettings } from "../shared/settings";
import { devopsSecretsSchema, devopsSettingsSchema } from "../shared/devops";
import { DevOps } from "./devops";
import { listClaudeCommands, listClaudeModels } from "./rooms/claude-project";
import { readProviderUsage } from "./provider-usage";
import { ProjectChecks } from "./checks/service";
import { BlameService } from "./blame";
import { detectProject } from "./checks/detect";
import { projectIcon } from "./project-icon";
import { TriageService } from "./triage/service";
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  safeStorage,
  shell,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { Store } from "./store";
import {
  loginProfile,
  experimentalCredentialName,
  type LoginProfile,
} from "./login-profile";
import { Gitea } from "./gitea";
import { launchCodex } from "./local";
import { projectTasks } from "./tasks";
import { inspectFolder } from "./repository";
import { Updater } from "./updater";
import { readLocalFile, saveLocalFile, flushLocalFiles } from "./local-files";
import {
  bodySchema,
  blameQuerySchema,
  draftSchema,
  filePathSchema,
  progressSchema,
  refSchema,
  repoSchema,
  shaSchema,
  sideSchema,
  workspaceSchema,
  normalizeServer,
} from "../shared/validation";
import {
  emptyProgress,
  emptyWorkspace,
  type ApiMethod,
  type ChangedFile,
  type Issue,
  type Pull,
  type Repo,
  type Review,
  type ReviewComment,
  type Discussion,
} from "../shared/types";
// Keep the existing instance lock, storage and credential identities after the Relay rename.
// On macOS, set the encryption namespace before Electron initializes Keychain;
// restore the display name after ready, once that namespace is fixed.
app.setName(experimentalCredentialName);
if (!process.env.RELAY_TEST_DATA)
  app.setPath(
    "userData",
    join(app.getPath("appData"), "Review Relay Experimental"),
  );
let startupLogin: LoginProfile = { credentialName: experimentalCredentialName };
let startupLoginError: unknown;
if (process.platform === "darwin") {
  try {
    startupLogin = loginProfile(
      app.getPath("userData"),
      join(app.getPath("appData"), "Review Relay"),
    );
    app.setName(startupLogin.credentialName);
  } catch (error) {
    startupLoginError = error;
  }
}
let rooms: RoomService;
let devops: DevOps;
let projects: Projects;
let projectChats: ProjectChats;
const pullRequestCreation = new PullRequestCreation();
const updater = new Updater(
  (state) => {
    if (win && !win.isDestroyed()) win.webContents.send("relay:update", state);
  },
  {
    runningTasks: () => projectChats?.runningTasks().length ?? 0,
    // Restarting for an update was the user's call, tasks or not.
    beforeQuit: () => (quitConfirmed = true),
  },
);
const liveSyncs = new Map<string, LiveSync>();
const startingLiveSyncRoots = new Set<string>();
async function stopSyncs() {
  await Promise.all([...liveSyncs.values()].map((s) => s.stop()));
  liveSyncs.clear();
}
let win: BrowserWindow | null = null,
  client: Gitea | null = null,
  store: Store,
  triage: TriageService,
  pendingUrl: string | undefined;
let loginRestore: "idle" | "unlocking" | "failed" = "idle";
let restoreGeneration = 0;
let windowReady = false;
const root = join(__dirname, "../dist/index.html");
const projectChecks = new ProjectChecks(join(__dirname, "checks-worker.mjs"));
const blame = new BlameService();
const dev = process.env.RELAY_DEV_URL;
const pageSchema = z.number().int().min(1).max(100000);
const requireClient = () => {
  if (!client) throw new Error("Connect your Gitea account first.");
  return client;
};
const repoKey = (r: { owner: string; name: string }) =>
  JSON.stringify([requireClient().account.id, r.owner, r.name]);
const prKey = (r: { owner: string; name: string; number: number }) =>
  JSON.stringify([requireClient().account.id, r.owner, r.name, r.number]);
/** The checkout linked to a Gitea repository, if any. */
const linkedFolder = (r: Repo): string | undefined =>
  store.get().folders[repoKey(r)];
function requireFolder(
  r: Repo,
  message = "Link this repository to a local folder first.",
) {
  const dir = linkedFolder(r);
  if (!dir) throw new Error(message);
  return dir;
}
/** Linux's basic_text backend stores plaintext; secrets then stay in memory. */
const canEncrypt = async () =>
  process.platform === "linux"
    ? safeStorage.isEncryptionAvailable() &&
      safeStorage.getSelectedStorageBackend() !== "basic_text"
    : await safeStorage.isAsyncEncryptionAvailable();
/** Encrypts with the OS credential store; null when it can't persist safely. */
const seal = async (value: string) =>
  (await canEncrypt())
    ? (await safeStorage.encryptStringAsync(value)).toString("base64")
    : null;
const unseal = async (value: string) =>
  (await safeStorage.decryptStringAsync(Buffer.from(value, "base64"))).result;
function showWindow() {
  // Dock activation, a second launch and deep links all restore the same window.
  if (!win) return;
  if (process.platform === "darwin") app.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function cancelLoginRestore() {
  restoreGeneration++;
  loginRestore = "idle";
}
async function restoreSavedLogin() {
  const saved = store.get();
  if (
    client ||
    loginRestore === "unlocking" ||
    !saved.account ||
    !saved.encryptedToken
  )
    return;
  const generation = ++restoreGeneration;
  loginRestore = "unlocking";
  try {
    const result = await unseal(saved.encryptedToken);
    // A delayed Keychain response must not undo a new sign-in or sign-out.
    if (generation !== restoreGeneration) return;
    if (!result) throw new Error("Empty saved credential");
    client = new Gitea(saved.account, result, (url, options) =>
      net.fetch(url, options),
    );
    loginRestore = "idle";
  } catch {
    // Preserve the saved credential and all review data for retry.
    if (generation === restoreGeneration) loginRestore = "failed";
  }
}
function receiveUrl(url: string) {
  if (!isAppUrl(url)) return;
  pendingUrl = url;
  if (!win && windowReady) createWindow();
  if (win) {
    showWindow();
    if (!win.webContents.isLoading()) {
      if (client) pendingUrl = undefined;
      win.webContents.send("relay:open-url", url);
    }
  }
}
function isAppUrl(url: string) {
  return (
    url.length <= 16384 &&
    (url.startsWith("reviewrelay:") || url.startsWith(roomProtocol + ":"))
  );
}
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
app.on("second-instance", (_event, args) => {
  const url = args.find(isAppUrl);
  if (url) receiveUrl(url);
  else {
    if (!win && windowReady) createWindow();
    showWindow();
  }
});
app.on("open-url", (e, url) => {
  e.preventDefault();
  receiveUrl(url);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
let quitReady = false,
  flushing = false,
  quitConfirmed = false,
  askingToQuit = false;
app.on("before-quit", (event) => {
  if (quitReady || !store) {
    blame.dispose();
    client?.dispose();
    return;
  }
  event.preventDefault();
  // Quitting ends Claude's sessions, and the background work they run.
  const tasks = quitConfirmed ? [] : (projectChats?.runningTasks() ?? []);
  if (tasks.length) {
    if (askingToQuit) return;
    askingToQuit = true;
    void dialog
      .showMessageBox({
        type: "warning",
        message:
          tasks.length === 1
            ? "Claude is still running something in the background."
            : `Claude is still running ${tasks.length} things in the background.`,
        detail: [
          ...tasks.slice(0, 5).map((t) => `• ${t.description}`),
          "",
          "Quitting stops it. Relay will offer to pick it back up next time.",
        ].join("\n"),
        buttons: ["Quit Anyway", "Keep Running"],
        defaultId: 1,
        cancelId: 1,
      })
      .then(({ response }) => {
        askingToQuit = false;
        if (response === 0) {
          quitConfirmed = true;
          return app.quit();
        }
        // Closing the last window quits on Windows and Linux: bring it back
        // rather than keep the work running with no window to watch it from.
        if (!win && windowReady) createWindow();
      });
    return;
  }
  triage?.cancel();
  if (flushing) return;
  flushing = true;
  void stopSyncs()
    .then(() => projectChats?.dispose())
    .then(() => rooms?.dispose())
    .then(() =>
      Promise.all([store.flush(), flushLocalFiles(), flushGitOperations()]),
    )
    .then(() => {
      quitReady = true;
      app.quit();
    })
    .catch(async () => {
      flushing = false;
      const choice = await dialog.showMessageBox({
        type: "error",
        title: "Review data could not be saved",
        message: "Some local review changes have not been saved.",
        detail:
          "Keep the app open and retry saving, or quit and lose those unsaved changes.",
        buttons: ["Keep open", "Quit without saving"],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice.response === 1) {
        quitReady = true;
        app.quit();
      }
    });
});
pendingUrl = process.argv.find(isAppUrl) ?? pendingUrl;
/** Windows has no badge count; a dot on the taskbar button stands in. */
function badgeDot() {
  const size = 16,
    pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2),
        alpha = Math.max(0, Math.min(1, size / 2 - d)),
        i = (y * size + x) * 4;
      // BGRA, premultiplied: #e5484d with an antialiased edge.
      pixels[i] = Math.round(0x4d * alpha);
      pixels[i + 1] = Math.round(0x48 * alpha);
      pixels[i + 2] = Math.round(0xe5 * alpha);
      pixels[i + 3] = Math.round(0xff * alpha);
    }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

function setBadge(count: number) {
  if (process.platform === "win32")
    win?.setOverlayIcon(
      count ? badgeDot() : null,
      count
        ? `${count} ${count === 1 ? "thread needs" : "threads need"} you`
        : "",
    );
  else app.setBadgeCount(count);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1050,
    minHeight: 650,
    show: false,
    title: "Relay",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#202124" : "#f6f6f6",
    // Adapted from T3 Code DesktopWindow.getWindowTitleBarOptions (MIT).
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 20, y: 22 },
          vibrancy: "sidebar" as const,
          visualEffectState: "followWindow" as const,
        }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            height: 62,
            color: nativeTheme.shouldUseDarkColors ? "#202124" : "#f6f6f6",
            symbolColor: nativeTheme.shouldUseDarkColors
              ? "#ffffff"
              : "#333333",
          },
        }),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // Reloading Relay itself counts as a navigation too: Vite's full reload
  // after re-bundling dependencies and the error screen's button need it.
  // Every other destination stays blocked.
  win.webContents.on("will-navigate", (e) => {
    const target = URL.parse(e.url);
    if (target) target.hash = "";
    const page = dev && !app.isPackaged ? `${dev}/` : pathToFileURL(root).href;
    if (target?.href !== page) e.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.once("ready-to-show", showWindow);
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win!, {
      type: "warning",
      title: "Unsaved code edits",
      message: "Close without saving your code edits?",
      detail: "Choose Keep editing to save or copy your changes first.",
      buttons: ["Keep editing", "Discard edits and close"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
    else {
      quitReady = false;
      flushing = false;
    }
  });
  win.webContents.on("render-process-gone", () => projectChecks.stop());
  win.on("closed", () => {
    blame.dispose();
    projectChecks.stop();
    // Only the window knows what's unread; a closed one can't clear it later.
    // (Windows quits with its last window, taking the overlay with it.)
    app.setBadgeCount(0);
    win = null;
  });
  if (dev && !app.isPackaged) {
    if (dev !== "http://127.0.0.1:5177") throw new Error("Invalid dev URL");
    void win.loadURL(dev);
  } else void win.loadFile(root);
}
const symbolQuerySchema = z
  .object({
    path: filePathSchema,
    line: z.number().int().min(1).max(500000),
    column: z.number().int().min(1).max(2000000),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(["hover", "definition", "references", "source"]),
  })
  .strict();
async function dispatch(method: ApiMethod, args: unknown[]) {
  switch (method) {
    case "localCheckInfo":
      return detectProject(await projects.root(idSchema.parse(args[0])));
    case "localCheckState":
      return projectChecks.state(
        "project:" + idSchema.parse(args[0]),
        shaSchema.parse(args[1]),
      );
    case "startLocalChecks": {
      const id = idSchema.parse(args[0]);
      return projectChecks.start(
        "project:" + id,
        await projects.root(id),
        null,
        null,
        shaSchema.parse(args[1]),
        z.string().max(4096).parse(args[2]),
      );
    }
    case "stopLocalChecks":
      projectChecks.stop("project:" + idSchema.parse(args[0]));
      return;
    case "pauseLocalChecks":
      projectChecks.pause(
        "project:" + idSchema.parse(args[0]),
        z.boolean().parse(args[1]),
      );
      return;
    case "updateLocalCheckBuffer":
      return projectChecks.update(
        "project:" + idSchema.parse(args[0]),
        shaSchema.parse(args[1]),
        workingPathSchema.parse(args[2]),
        z
          .string()
          .max(2 * 1024 * 1024)
          .nullable()
          .parse(args[3]),
      );
    case "inspectLocalSymbol":
      return projectChecks.symbol(
        "project:" + idSchema.parse(args[0]),
        shaSchema.parse(args[1]),
        symbolQuerySchema.parse(args[2]),
      );
    case "localBlame":
      return blame.read(
        await projects.root(idSchema.parse(args[0])),
        null,
        null,
        blameQuerySchema.parse(args[1]),
      );
    case "projectIcon":
      return projectIcon(
        await projects.root(idSchema.parse(args[0])),
        (path) => {
          const image = nativeImage.createFromPath(path);
          return image.isEmpty()
            ? null
            : image.resize({ width: 128, quality: "best" }).toDataURL();
        },
      );
    case "projectGroups":
      return projects.groups();
    case "createProjectGroup":
      return projects.createGroup(projectFolderSchema.parse(args[0]));
    case "renameProjectGroup":
      return projects.renameGroup(
        projectFolderSchema.parse(args[0]),
        projectFolderSchema.parse(args[1]),
      );
    case "removeProjectGroup":
      return projects.removeGroup(projectFolderSchema.parse(args[0]));
    case "moveProject":
      return projects.move(
        idSchema.parse(args[0]),
        projectFolderSchema.parse(args[1]),
        idSchema.nullable().parse(args[2]),
      );
    case "renameProject":
      return projects.rename(
        idSchema.parse(args[0]),
        projectNameSchema.parse(args[1]),
      );
    case "revealProject": {
      const error = await shell.openPath(
        await projects.root(idSchema.parse(args[0])),
      );
      if (error) throw new Error(error);
      return;
    }
    case "projects":
      return projects.list(client);
    case "addProject": {
      const result = await dialog.showOpenDialog(win!, {
        title: "Add a local Git project",
        properties: ["openDirectory"],
      });
      return result.canceled ? null : projects.add(result.filePaths[0], client);
    }
    case "linkProject":
      return projects.link(idSchema.parse(args[0]), requireClient());
    case "setProjectChatScope":
      return projectChats.setScope(
        idSchema.parse(args[0]),
        chatScopeSchema.parse(args[1]),
      );
    case "triageProjectChat":
      return projectChats.triage(
        idSchema.parse(args[0]),
        chatTriageSchema.parse(args[1]),
      );
    case "renameProjectChat":
      return projectChats.rename(
        idSchema.parse(args[0]),
        z.string().parse(args[1]),
      );
    case "projectCommands": {
      const root = await projects.root(idSchema.parse(args[0]));
      const provider = z.enum(["codex", "claude"]).parse(args[1]);
      return provider === "codex"
        ? (await codexSkills(root)).map(presentSkill)
        : listClaudeCommands(root);
    }
    case "projectBranchPulls":
    case "projectPreparePull":
    case "projectCreatePull": {
      const id = idSchema.parse(args[0]);
      const client = requireClient();
      const repo = await projects.linked(id, client);
      const root = await projects.root(id);
      if (method === "projectBranchPulls")
        return branchPulls(root, client, repo);
      if (method === "projectPreparePull")
        return pullRequestCreation.prepare(root, client, repo);
      return pullRequestCreation.create(
        root,
        client,
        createPullRequestSchema.parse(args[1]),
      );
    }
    case "projectBranches":
      return branches(await projects.root(idSchema.parse(args[0])));
    case "projectChangeBranch": {
      const id = idSchema.parse(args[0]);
      const action = branchActionSchema.parse(args[1]);
      projects.assertCheckoutAvailable(id);
      projects.changingBranch.add(id);
      try {
        const root = await projects.root(id);
        if (projectChats.hasActiveProject(id))
          throw new Error(
            "Stop the running agent in this project before switching branches.",
          );
        if (
          startingLiveSyncRoots.has(root) ||
          [...liveSyncs.values()].some(
            (sync) => sync.root === root && sync.status().active,
          )
        )
          throw new Error("Pause live file sync before switching branches.");
        const result = await changeBranch(root, action);
        projectChecks.stop();
        return result;
      } finally {
        projects.changingBranch.delete(id);
      }
    }
    case "projectFiles":
      return projects.files(idSchema.parse(args[0]));
    case "projectFile":
      return projects.file(
        idSchema.parse(args[0]),
        workingPathSchema.parse(args[1]),
      );
    case "saveProjectFile":
      return projects.save(
        idSchema.parse(args[0]),
        workingPathSchema.parse(args[1]),
        shaSchema.parse(args[2]),
        z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(args[3]),
        z
          .string()
          .max(2 * 1024 * 1024)
          .parse(args[4]),
      );
    case "projectTasks":
      return projectTasks.list(await projects.root(idSchema.parse(args[0])));
    case "stopProjectTask":
      return projectTasks.stop(
        await projects.root(idSchema.parse(args[0])),
        z.string().max(64).parse(args[1]),
      );
    case "restartProjectTask":
      return projectTasks.restart(
        await projects.root(idSchema.parse(args[0])),
        z.string().max(64).parse(args[1]),
      );
    case "projectWorkingTree":
      return workingTree(await projects.root(idSchema.parse(args[0])));
    case "projectWorkingDiff":
      return workingDiff(
        await projects.root(idSchema.parse(args[0])),
        workingPathSchema.parse(args[1]),
        z.enum(["staged", "unstaged"]).parse(args[2]),
      );
    case "projectTurnDiff":
      return projectChats.turnDiff(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
        workingPathSchema.parse(args[2]),
      );
    case "rewindProjectTurn":
      return projectChats.rewindTurn(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
        z.array(workingPathSchema).max(1000).nullable().parse(args[2]),
        z.enum(["revert", "redo"]).parse(args[3]),
        z.boolean().parse(args[4]),
      );
    case "projectGitAction":
      return performGitAction(
        await projects.root(idSchema.parse(args[0])),
        gitActionSchema.parse(args[1]),
      );
    case "projectPulls": {
      const client = requireClient();
      const repo = await projects.linked(idSchema.parse(args[0]), client);
      const page = await client.page<Pull>(
        `${client.repo(repo)}/pulls?state=${z.enum(["open", "closed", "all"]).parse(args[1])}`,
        pageSchema.parse(args[2]),
      );
      return {
        ...page,
        items: page.items.map((p) => ({
          ...p,
          repository: {
            name: repo.name,
            full_name: `${repo.owner}/${repo.name}`,
            owner: repo.owner,
          },
          pull_request: { merged: p.merged },
        })),
      };
    }
    case "resolveStoppedWork":
      return projectChats.resolveStoppedWork(
        idSchema.parse(args[0]),
        z.enum(["resume", "dismiss"]).parse(args[1]),
      );
    case "stopProjectChatPending":
      return projectChats.stopPending(
        idSchema.parse(args[0]),
        z.string().min(1).max(200).parse(args[1]),
      );
    case "projectChatPresence":
      return projectChats.presence(
        idSchema.parse(args[0]),
        presenceSchema.omit({ head: true }).nullable().parse(args[1]),
      );
    case "projectChatShareInfo":
      return projectChats.shareInfo(idSchema.parse(args[0]));
    case "shareProjectChat":
      return projectChats.share(idSchema.parse(args[0]));
    case "syncProjectChat": {
      const id = idSchema.parse(args[0]);
      return args[1] == null
        ? projectChats.sync(id)
        : projectChats.syncChanges(id, knownMessagesSchema.parse(args[1]));
    }
    case "projectChatInvite":
      return projectChats.invite(idSchema.parse(args[0]));
    case "sharedProjectChats":
      return projectChats.sharedList(idSchema.parse(args[0]));
    case "openSharedProjectChat":
      return projectChats.openShared(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
      );
    case "joinProjectConversation":
      return projectChats.join(
        idSchema.parse(args[0]),
        z.string().max(16384).parse(args[1]),
      );
    case "projectChats":
      return projectChats.list(idSchema.parse(args[0]));
    case "createProjectChat":
      return projectChats.create(
        idSchema.parse(args[0]),
        chatScopeSchema.parse(args[1]),
      );
    case "projectChat": {
      const id = idSchema.parse(args[0]);
      const chat =
        args[1] == null
          ? await projectChats.get(id)
          : await projectChats.changes(id, knownMessagesSchema.parse(args[1]));
      projectChats.ensureTitle(id);
      return chat;
    }
    case "projectChatImage":
      return projectChats.image(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
      );
    case "sendProjectChat":
      return projectChats.send(
        idSchema.parse(args[0]),
        projectChatSendSchema.parse(args[1]),
      );
    case "resumeProjectChat":
      return projectChats.resume(idSchema.parse(args[0]));
    case "compactProjectChat":
      return projectChats.compact(
        idSchema.parse(args[0]),
        args[1] == null ? undefined : idSchema.parse(args[1]),
        z.string().trim().max(4000).optional().parse(args[2]) || undefined,
      );
    case "projectChatQueueAction":
      return projectChats.queueAction(
        idSchema.parse(args[0]),
        z.enum(["remove", "steer", "move"]).parse(args[1]),
        idSchema.parse(args[2]),
        z.number().int().min(0).max(20).optional().parse(args[3]),
      );
    case "respondProjectChat":
      return projectChats.respond(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
        agentResponseSchema.parse(args[2]),
      );
    case "cancelProjectChat":
      return projectChats.cancel(idSchema.parse(args[0]));
    case "startDeepReview": {
      const id = idSchema.parse(args[0]);
      const config = deepReviewStartSchema.parse(args[1]);
      // The forge knows which branch a pull request merges into.
      const pull =
        config.target.kind === "pr"
          ? await requireClient().pull(config.target.ref)
          : undefined;
      return projectChats.startDeepReview(
        id,
        config,
        pull && { number: pull.number, title: pull.title, base: pull.base.ref },
      );
    }
    case "resumeDeepReview":
      return projectChats.resumeDeepReview(idSchema.parse(args[0]));
    case "setDeepReviewFinding":
      return projectChats.setDeepReviewFinding(
        idSchema.parse(args[0]),
        z
          .string()
          .regex(/^F\d{1,3}$/)
          .parse(args[1]),
        z.enum(["open", "dismissed"]).parse(args[2]),
      );
    case "projectRecentCommits": {
      const log = await git(await projects.root(idSchema.parse(args[0])), [
        "log",
        "-40",
        "--format=%H%x00%s",
      ]).catch(() => "");
      return log
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, subject] = line.split("\0");
          return { sha: sha!, subject: (subject ?? "").slice(0, 200) };
        });
    }
    case "roomHosting":
      return rooms.hostingStatus();
    case "saveRoomHosting":
      return rooms.saveHosting(roomHostingSchema.nullable().parse(args[0]));
    case "roomAcceptInvitation": {
      const invitation = parseRoomInvitation(
        z.string().max(16384).parse(args[0]),
      );
      if (!invitation.project || !invitation.number)
        throw new Error(
          "This older invitation has no PR target. Open its repository and paste the invitation in the room.",
        );
      if (
        normalizeServer(invitation.project.server) !==
        normalizeServer(requireClient().account.server)
      )
        throw new Error(
          `Sign into ${invitation.project.server} in Settings to join this project.`,
        );
      const ref = refSchema.parse({
        ...invitation.project,
        number: invitation.number,
      });
      const context = {
        client: requireClient(),
        ref,
        key: repoKey(ref),
        dir: linkedFolder(ref),
      };
      await rooms.allowAccess(context, invitation.server);
      const state = await rooms.connect(context, {
        server: invitation.server,
        secret: invitation.secret,
        projectId: invitation.projectId,
      });
      return { ref, state };
    }
    case "liveSyncState":
    case "liveSyncStart":
    case "liveSyncStop":
    case "liveSyncConflict":
    case "liveSyncResolve": {
      const target = z
        .union([z.object({ chatId: idSchema }).strict(), refSchema])
        .parse(args[0]);
      const key = "chatId" in target ? "chat:" + target.chatId : prKey(target);
      let sync = liveSyncs.get(key);
      if (method === "liveSyncState") return sync?.status() ?? idleSync;
      if (method === "liveSyncStop") {
        await sync?.stop();
        return;
      }
      if (method === "liveSyncStart") {
        if (sync?.status().active) return sync.status();
        let workspace: {
          id: string;
          root: string;
          validate: () => Promise<unknown>;
          request: (
            path: string,
            method?: string,
            body?: unknown,
          ) => Promise<unknown>;
        };
        if ("chatId" in target)
          workspace = await projectChats.workspace(target.chatId);
        else {
          const client = requireClient();
          const root = await validateRepo(
            requireFolder(target),
            client.account.server,
            target,
          );
          workspace = {
            ...(await rooms.workspace({
              client,
              ref: target,
              key: repoKey(target),
              dir: root,
            })),
            root,
            validate: () => validateRepo(root, client.account.server, target),
          };
        }
        const root = workspace.root;
        for (const project of store.get().projects ?? [])
          if (project.path === root)
            projects.assertCheckoutAvailable(project.id);
        for (const [other, active] of liveSyncs)
          if (other !== key && active.root === root && active.status().active)
            throw new Error(
              "This checkout is syncing another conversation. Pause it first or use a separate checkout.",
            );
        sync = new LiveSync(
          root,
          join(
            app.getPath("userData"),
            "live-sync",
            digest(root + workspace.id) + ".json",
          ),
          workspace.request,
          workspace.validate,
        );
        startingLiveSyncRoots.add(root);
        try {
          const state = await sync.start();
          liveSyncs.set(key, sync);
          return state;
        } finally {
          startingLiveSyncRoots.delete(root);
        }
      }
      if (!sync?.status().active)
        throw new Error("Resume live sync before resolving files.");
      const path = workingPathSchema.parse(args[1]);
      if (method === "liveSyncConflict") return sync.conflict(path);
      return sync.resolve(
        path,
        z.enum(["local", "shared"]).parse(args[2]),
        z.number().int().positive().parse(args[3]),
        z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable()
          .parse(args[4]),
      );
    }
    case "roomAccessInfo":
    case "allowRoomAccess":
    case "roomConnect":
    case "roomState":
    case "roomDisconnect":
    case "roomPoll":
    case "roomSend":
    case "roomCancel":
    case "roomPresence":
    case "roomInvite":
    case "roomMembers":
    case "roomRevoke": {
      const ref = refSchema.parse(args[0]);
      const context = {
        client: requireClient(),
        ref,
        key: repoKey(ref),
        dir: linkedFolder(ref),
      };
      if (method === "roomAccessInfo")
        return { server: await rooms.projectServer(context) };
      if (method === "allowRoomAccess")
        return rooms.allowAccess(
          context,
          roomHostingSchema.shape.server.parse(args[1]),
        );
      if (method === "roomConnect")
        return rooms.connect(context, connectRoomSchema.parse(args[1]));
      if (method === "roomState") return rooms.state(context);
      if (method === "roomDisconnect") {
        // PR keys extend this repository's key: [account, owner, name, number].
        for (const [key, sync] of liveSyncs)
          if (key.startsWith(repoKey(ref).slice(0, -1) + ","))
            await sync.stop();
        return rooms.disconnect(context);
      }
      if (method === "roomPoll")
        return rooms.poll(
          context,
          z.number().int().nonnegative().parse(args[1]),
          args[2] === undefined
            ? undefined
            : z.number().int().nonnegative().parse(args[2]),
        );
      if (method === "roomSend")
        return rooms.send(context, sendRoomSchema.parse(args[1]));
      if (method === "roomCancel")
        return rooms.cancel(context, idSchema.parse(args[1]));
      if (method === "roomPresence")
        return rooms.presence(
          context,
          presenceSchema.nullable().parse(args[1]),
        );
      if (method === "roomInvite") return rooms.invite(context);
      if (method === "roomMembers") return rooms.members(context);
      return rooms.revoke(context, idSchema.parse(args[1]));
    }

    case "triageState":
    case "startTriage":
    case "cancelTriage":
    case "groupPaths": {
      const ref = refSchema.parse(args[0]),
        head = shaSchema.parse(args[1]),
        base = shaSchema.parse(args[2]),
        key = prKey(ref);
      if (method === "triageState") return triage.state(key, `${base}:${head}`);
      if (method === "startTriage")
        return triage.start(requireClient(), ref, key, head, base);
      if (method === "groupPaths")
        return triage.groupPaths(
          requireClient(),
          ref,
          key,
          head,
          base,
          z.string().max(100).parse(args[3]),
        );
      const state = await triage.state(key, `${base}:${head}`);
      if (
        state?.status === "scanning" ||
        state?.status === "classifying" ||
        state?.status === "matching"
      )
        triage.cancel();
      return;
    }
    case "bootstrap": {
      const url = pendingUrl;
      if (client) pendingUrl = undefined;
      return {
        account: client?.account ?? null,
        accounts: client ? [client.account] : [],
        platform: process.platform,
        loginRestore,
        savedServer: store.get().account?.server,
        pendingUrl: url,
        workspace: workspaceSchema.parse(
          (client && store.get().workspaces?.[client.account.id]) ??
            emptyWorkspace(),
        ),
      };
    }
    case "retryLoginRestore":
      void restoreSavedLogin();
      return;
    case "cancelLoginRestore":
      cancelLoginRestore();
      return;
    case "saveWorkspace": {
      const accountId = requireClient().account.id;
      const workspace = workspaceSchema.parse(args[0]);
      await store.update((s) => {
        s.workspaces ??= {};
        s.workspaces[accountId] = workspace;
      });
      return;
    }
    case "connect": {
      const server = z.string().max(2048).parse(args[0]),
        token = z.string().trim().min(1).max(4096).parse(args[1]);
      cancelLoginRestore();
      const next = await Gitea.connect(server, token, (url, options) =>
        net.fetch(url, options),
      );
      const encryptedToken = (await seal(token)) ?? undefined;
      next.account.persistent = encryptedToken !== undefined;
      await store.update((s) => {
        s.account = next.account;
        s.encryptedToken = encryptedToken;
      });
      triage.cancel();
      projectChecks.stop();
      blame.dispose();
      client?.dispose();
      client = next;
      return next.account;
    }
    case "disconnect":
      await stopSyncs();
      await rooms.dispose();
      blame.dispose();
      projectChecks.stop();
      cancelLoginRestore();
      await store.update((s) => {
        delete s.account;
        delete s.encryptedToken;
      });
      triage.cancel();
      client?.dispose();
      client = null;
      return;
    case "search": {
      const filter = z
          .enum(["review_requested", "assigned", "created", "all"])
          .parse(args[0]),
        q = z.string().max(500).parse(args[1]),
        state = z.enum(["open", "closed", "all"]).parse(args[2]),
        page = pageSchema.parse(args[3]);
      const query = new URLSearchParams({
        type: "pulls",
        state,
        q,
        ...(filter === "all" ? {} : { [filter]: "true" }),
      });
      return requireClient().page<Issue>(`/repos/issues/search?${query}`, page);
    }
    case "parseUrl":
      return requireClient().parseUrl(z.string().max(4096).parse(args[0]));
    case "pull":
      return requireClient().pull(refSchema.parse(args[0]));
    case "files": {
      const r = refSchema.parse(args[0]);
      return requireClient().page<ChangedFile>(
        `${requireClient().pr(r)}/files`,
        pageSchema.parse(args[1]),
      );
    }
    case "contents": {
      const r = refSchema.parse(args[0]),
        file = z
          .object({
            filename: filePathSchema,
            previous_filename: filePathSchema.optional(),
            status: z.string().max(30),
            additions: z.number(),
            deletions: z.number(),
            changes: z.number(),
          })
          .parse(args[1]);
      return requireClient().contents(
        r,
        file,
        shaSchema.parse(args[2]),
        shaSchema.parse(args[3]),
      );
    }
    case "blame": {
      const r = refSchema.parse(args[0]),
        query = blameQuerySchema.parse(args[1]),
        dir = requireFolder(
          r,
          "Link this repository to a local folder to see line history.",
        );
      return blame.read(dir, requireClient().account.server, r, query);
    }
    case "reviews": {
      const r = refSchema.parse(args[0]);
      return requireClient().page<Review>(
        `${requireClient().pr(r)}/reviews`,
        pageSchema.parse(args[1]),
      );
    }
    case "reviewComments": {
      const r = refSchema.parse(args[0]);
      return (
        await requireClient().request<ReviewComment[]>(
          `${requireClient().pr(r)}/reviews/${z.number().int().positive().parse(args[1])}/comments`,
        )
      ).data;
    }
    case "discussion": {
      const r = refSchema.parse(args[0]);
      return requireClient().page<Discussion>(
        `${requireClient().repo(r)}/issues/${r.number}/comments`,
        pageSchema.parse(args[1]),
      );
    }
    case "progress":
      return (
        store.get().progress[prKey(refSchema.parse(args[0]))] ?? emptyProgress()
      );
    case "saveProgress": {
      const key = prKey(refSchema.parse(args[0])),
        progress = progressSchema.parse(args[1]);
      await store.update((s) => {
        s.progress[key] = progress;
      });
      return;
    }
    case "submitReview":
      return requireClient().submit(
        refSchema.parse(args[0]),
        shaSchema.parse(args[1]),
        z.enum(["COMMENT", "APPROVED", "REQUEST_CHANGES"]).parse(args[2]),
        z.string().max(65536).parse(args[3]),
        z.array(draftSchema).max(1000).parse(args[4]),
      );
    case "resolveComment": {
      const r = refSchema.parse(args[0]);
      await requireClient().request(
        `${requireClient().repo(r)}/pulls/comments/${z.number().int().positive().parse(args[1])}/${z.boolean().parse(args[2]) ? "resolve" : "unresolve"}`,
        { method: "POST" },
      );
      return;
    }
    case "reply": {
      const r = refSchema.parse(args[0]);
      return (
        await requireClient().request(
          `${requireClient().pr(r)}/comments/${z.number().int().positive().parse(args[1])}/replies`,
          { method: "POST", body: { body: bodySchema.parse(args[2]) } },
        )
      ).data;
    }
    case "comment": {
      const r = refSchema.parse(args[0]);
      return (
        await requireClient().request(
          `${requireClient().repo(r)}/issues/${r.number}/comments`,
          { method: "POST", body: { body: bodySchema.parse(args[1]) } },
        )
      ).data;
    }
    case "workingTree":
    case "workingDiff":
    case "gitAction": {
      const r = repoSchema.parse(args[0]);
      const root = await validateRepo(
        requireFolder(r),
        requireClient().account.server,
        r,
      );
      if (method === "workingTree") return workingTree(root);
      if (method === "workingDiff")
        return workingDiff(
          root,
          workingPathSchema.parse(args[1]),
          z.enum(["staged", "unstaged"]).parse(args[2]),
        );
      return performGitAction(root, gitActionSchema.parse(args[1]));
    }
    case "folder": {
      const r = repoSchema.parse(args[0]),
        dir = linkedFolder(r);
      return dir ? inspectFolder(dir, requireClient().account.server, r) : null;
    }
    case "linkFolder": {
      const r = repoSchema.parse(args[0]);
      const result = await dialog.showOpenDialog(win!, {
        title: "Link local Git repository",
        properties: ["openDirectory"],
      });
      if (result.canceled) return null;
      const local = await inspectFolder(
        result.filePaths[0],
        requireClient().account.server,
        r,
      );
      if (!local.remoteMatches)
        throw new Error(
          "This folder’s Git remote does not match the Gitea project. Choose the correct repository.",
        );
      for (const sync of liveSyncs.values())
        if (sync.root === linkedFolder(r)) await sync.stop();
      await store.update((s) => {
        s.folders[repoKey(r)] = local.path;
      });
      return local;
    }
    case "inspectSymbol":
      return projectChecks.symbol(
        prKey(refSchema.parse(args[0])),
        shaSchema.parse(args[1]),
        symbolQuerySchema.parse(args[2]),
      );
    case "projectCheckInfo": {
      const dir = linkedFolder(refSchema.parse(args[0]));
      return dir ? detectProject(dir) : null;
    }
    case "projectCheckState":
      return projectChecks.state(
        prKey(refSchema.parse(args[0])),
        shaSchema.parse(args[1]),
      );
    case "stopProjectChecks":
      projectChecks.stop(prKey(refSchema.parse(args[0])));
      return;
    case "pauseProjectChecks":
      projectChecks.pause(
        prKey(refSchema.parse(args[0])),
        z.boolean().parse(args[1]),
      );
      return;
    case "startProjectChecks": {
      const r = refSchema.parse(args[0]),
        head = shaSchema.parse(args[1]);
      return projectChecks.start(
        prKey(r),
        requireFolder(r),
        requireClient().account.server,
        r,
        head,
        z.string().max(4096).parse(args[2]),
      );
    }
    case "updateCheckBuffer":
      return projectChecks.update(
        prKey(refSchema.parse(args[0])),
        shaSchema.parse(args[1]),
        filePathSchema.parse(args[2]),
        z
          .string()
          .max(2 * 1024 * 1024)
          .nullable()
          .parse(args[3]),
      );
    case "writeClipboard":
      await clipboard.writeText(z.string().max(32768).parse(args[0]));
      return;
    case "writeClipboardImage": {
      const image = nativeImage.createFromDataURL(
        z
          .string()
          .max(64 * 1024 * 1024)
          .startsWith("data:image/")
          .parse(args[0]),
      );
      if (image.isEmpty()) throw new Error("Couldn't read that image.");
      const png = new Blob([new Uint8Array(image.toPNG())]);
      await clipboard.write([new ClipboardItem({ "image/png": png })]);
      return;
    }
    case "readClipboard":
      return clipboard.readText();
    case "readLocalFile":
    case "saveLocalFile": {
      const r = refSchema.parse(args[0]);
      const dir = requireFolder(r);
      const head = shaSchema.parse(args[1]);
      const path = filePathSchema.parse(args[2]);
      if ((await requireClient().pull(r)).head.sha !== head)
        throw new Error(
          "This PR has new commits. Refresh it and check out the new head before editing.",
        );
      const server = requireClient().account.server;
      if (method === "readLocalFile")
        return readLocalFile(dir, server, r, head, path);
      return saveLocalFile(
        dir,
        server,
        r,
        head,
        path,
        z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(args[3]),
        z
          .string()
          .max(2 * 1024 * 1024)
          .parse(args[4]),
      );
    }
    case "aiSettings":
      return aiSettingsSchema.parse(
        store.get().aiSettings ?? defaultAISettings,
      );
    case "saveAISettings": {
      const settings = aiSettingsSchema.parse(args[0]);
      await store.update((s) => {
        s.aiSettings = settings;
      });
      return settings;
    }
    case "devopsStatus":
      return devops.status();
    case "saveDevOpsSettings":
      return devops.save(
        devopsSettingsSchema.parse(args[0]),
        devopsSecretsSchema.parse(args[1] ?? {}),
      );
    case "devopsWorkItems": {
      const id = z.string().max(200).nullable().parse(args[0]);
      return devops.workItems(
        id ? projects.get(id) : null,
        z.boolean().optional().parse(args[1]),
      );
    }
    case "claudeModels":
      return listClaudeModels();
    case "codexModels":
      return codexModels();
    case "providerUsage":
      return readProviderUsage(z.enum(["claude", "codex"]).parse(args[0]));
    case "askCodex": {
      const ref = refSchema.parse(args[0]),
        question = lineQuestionSchema.parse(args[1]);
      const dir = requireFolder(ref);
      const settings = aiSettingsSchema.parse(
        store.get().aiSettings ?? defaultAISettings,
      );
      await launchLineQuestion(
        requireClient(),
        dir,
        app.getPath("userData"),
        ref,
        question,
        settings.questions,
        settings.questionsProvider,
      );
      return;
    }
    case "launchCodex": {
      const r = refSchema.parse(args[0]),
        dir = requireFolder(r);
      const head = shaSchema.parse(args[1]);
      const p = await requireClient().pull(r);
      if (p.head.sha !== head)
        throw new Error("This PR changed. Refresh before starting Codex.");
      await launchCodex(
        dir,
        app.getPath("userData"),
        r,
        head,
        filePathSchema.parse(args[2]),
        z.number().int().positive().parse(args[3]),
        sideSchema.parse(args[4]),
        bodySchema.parse(args[5]),
        requireClient().account.server,
      );
      return;
    }
    case "applyAppearance": {
      const appearance = z
        .object({
          kind: z.enum(["light", "dark"]),
          background: z.string().regex(/^#[0-9a-f]{6}$/i),
          icon: z
            .string()
            .max(2_000_000)
            .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
        })
        .strict()
        .parse(args[0]);
      // Native chrome (vibrancy, menus, scrollbars) follows the theme's mode.
      nativeTheme.themeSource = appearance.kind;
      win?.setBackgroundColor(appearance.background);
      const icon = nativeImage.createFromDataURL(appearance.icon);
      if (!icon.isEmpty()) {
        if (process.platform === "darwin") app.dock?.setIcon(icon);
        else win?.setIcon(icon);
      }
      return;
    }
    case "setBadge":
      setBadge(z.number().int().min(0).max(9999).parse(args[0]));
      return;
    case "updateState":
      return updater.current;
    case "checkForUpdates":
      return updater.check();
    case "downloadUpdate":
      return updater.download();
    case "installUpdate":
      return updater.installAndRestart();
    case "openExternal": {
      const u = new URL(z.string().max(4096).parse(args[0]));
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
        throw new Error("Unsupported URL.");
      await shell.openExternal(u.href);
      return;
    }
    default:
      throw new Error("Unknown application method.");
  }
}
app
  .whenReady()
  .then(async () => {
    app.setName("Relay");
    if (startupLoginError) throw startupLoginError;
    store = new Store(app.getPath("userData"));
    await store.load();
    if (startupLogin.imported) {
      await store.update((state) => {
        state.account = startupLogin.imported!.account;
        state.encryptedToken = startupLogin.imported!.encryptedToken;
        state.credentialName = startupLogin.credentialName;
      });
    }
    projects = new Projects(store);

    rooms = new RoomService(
      store,
      (url, init) => net.fetch(url, init),
      seal,
      unseal,
    );
    devops = new DevOps(
      store,
      (url, init) => net.fetch(url, init),
      seal,
      unseal,
      join(app.getPath("userData"), "devops-relevance.json"),
    );
    projectChats = new ProjectChats(
      store,
      projects,
      join(app.getPath("userData"), "project-chats"),
      (event) => {
        if (win && !win.isDestroyed())
          win.webContents.send("relay:project-chat", event);
      },
      new ProjectSharing(projects, rooms, requireClient),
      async (chat, selection) => {
        if (chat.scope.kind !== "pr")
          throw new Error("This is not a pull request conversation.");
        const client = requireClient(),
          repo = await projects.linked(chat.projectId, client);
        if (
          repo.owner !== chat.scope.ref.owner ||
          repo.name !== chat.scope.ref.name
        )
          throw new Error("The selected PR does not match this project.");
        return questionContext(client, chat.scope.ref, selection);
      },
    );
    if (hostingSetup) {
      const input = await hostingSetup;
      if ("error" in input) throw input.error;
      await rooms.saveHosting(input.value);
      await store.flush();
      console.log("Shared-room hosting access saved securely.");
      quitReady = true;
      app.quit();
      return;
    }
    triage = new TriageService(store, app.getPath("userData"));
    ipcMain.handle("relay:invoke", async (event, method, args) => {
      const source = event.senderFrame?.url;
      if (
        event.sender !== win?.webContents ||
        event.senderFrame !== win?.webContents.mainFrame ||
        !(
          source === pathToFileURL(root).href ||
          (!app.isPackaged && source === `${dev}/`)
        )
      )
        throw new Error("Untrusted IPC sender");
      try {
        return {
          ok: true,
          // Unknown names fall through to dispatch's default case.
          value: await dispatch(
            z.string().parse(method) as ApiMethod,
            z.array(z.unknown()).max(10).parse(args),
          ),
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Unexpected error",
        };
      }
    });
    projectChats.armWakeups();
    updater.start();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Relay",
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        { role: "editMenu" },
        {
          label: "View",
          submenu: [
            // Cmd/Ctrl R belongs to Replace in the local code editor.
            { role: "reload", accelerator: "CmdOrCtrl+Shift+R" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        { role: "windowMenu" },
      ]),
    );
    // Use a dedicated invitation scheme; stable PR links keep their existing handler.
    if (app.isPackaged) app.setAsDefaultProtocolClient(roomProtocol);
    windowReady = true;
    createWindow();
    void restoreSavedLogin();
    app.on("activate", () => {
      if (!win) createWindow();
      else showWindow();
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
