import { RoomService } from "./rooms/service";
import {
  connectRoomSchema,
  sendRoomSchema,
  presenceSchema,
  idSchema,
} from "../shared/rooms";
import { launchLineQuestion } from "./questions";
import { lineQuestionSchema } from "../shared/questions";
import { aiSettingsSchema, defaultAISettings } from "../shared/settings";
import { ProjectChecks } from "./checks/service";
import { BlameService } from "./blame";
import { detectProject } from "./checks/detect";
import { TriageService } from "./triage/service";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
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
import { inspectFolder } from "./repository";
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
} from "../shared/validation";
import {
  emptyProgress,
  emptyWorkspace,
  type ChangedFile,
  type Issue,
  type Review,
  type ReviewComment,
  type Discussion,
} from "../shared/types";
// The Dock identity, instance lock and saved reviews remain experimental.
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
    const { result } = await safeStorage.decryptStringAsync(
      Buffer.from(saved.encryptedToken, "base64"),
    );
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
  if (!url.startsWith("reviewrelay:")) return;
  pendingUrl = url;
  if (!win && windowReady) createWindow();
  if (win) {
    showWindow();
    if (client && !win.webContents.isLoading()) {
      pendingUrl = undefined;
      win.webContents.send("relay:open-url", url);
    }
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (_event, args) => {
  const url = args.find((a) => a.startsWith("reviewrelay:"));
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
  flushing = false;
app.on("before-quit", (event) => {
  if (quitReady || !store) {
    blame.dispose();
    client?.dispose();
    return;
  }
  event.preventDefault();
  triage?.cancel();
  if (flushing) return;
  flushing = true;
  void (rooms?.dispose() ?? Promise.resolve())
    .then(() => Promise.all([store.flush(), flushLocalFiles()]))
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
pendingUrl =
  process.argv.find((value) => value.startsWith("reviewrelay:")) ?? pendingUrl;
function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1050,
    minHeight: 650,
    show: false,
    title: "Review Relay Experimental",
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
  win.webContents.on("will-navigate", (e) => e.preventDefault());
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
    win = null;
  });
  if (dev && !app.isPackaged) {
    if (dev !== "http://127.0.0.1:5177") throw new Error("Invalid dev URL");
    void win.loadURL(dev);
  } else void win.loadFile(root);
}
async function dispatch(method: string, args: unknown[]) {
  switch (method) {
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
        dir: store.get().folders[repoKey(ref)],
      };
      if (method === "roomConnect")
        return rooms.connect(context, connectRoomSchema.parse(args[1]));
      if (method === "roomState") return rooms.state(context);
      if (method === "roomDisconnect") return rooms.disconnect(context);
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
      const persistent =
        process.platform === "linux"
          ? safeStorage.isEncryptionAvailable() &&
            safeStorage.getSelectedStorageBackend() !== "basic_text"
          : await safeStorage.isAsyncEncryptionAvailable();
      const encryptedToken = persistent
        ? (await safeStorage.encryptStringAsync(token)).toString("base64")
        : undefined;
      next.account.persistent = persistent;
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
        dir = store.get().folders[repoKey(r)];
      if (!dir)
        throw new Error(
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
    case "folder": {
      const r = repoSchema.parse(args[0]),
        dir = store.get().folders[repoKey(r)];
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
      await store.update((s) => {
        s.folders[repoKey(r)] = local.path;
      });
      return local;
    }
    case "inspectSymbol":
      return projectChecks.symbol(
        prKey(refSchema.parse(args[0])),
        shaSchema.parse(args[1]),
        z
          .object({
            path: filePathSchema,
            line: z.number().int().min(1).max(500000),
            column: z.number().int().min(1).max(2000000),
            hash: z.string().regex(/^[a-f0-9]{64}$/),
            kind: z.enum(["hover", "definition", "references", "source"]),
          })
          .strict()
          .parse(args[2]),
      );
    case "projectCheckInfo": {
      const r = refSchema.parse(args[0]);
      const dir = store.get().folders[repoKey(r)];
      if (!dir) return null;
      return detectProject(dir);
    }
    case "projectCheckState":
      return projectChecks.state(
        prKey(refSchema.parse(args[0])),
        shaSchema.parse(args[1]),
      );
    case "stopProjectChecks":
      projectChecks.stop(prKey(refSchema.parse(args[0])));
      return;
    case "startProjectChecks": {
      const r = refSchema.parse(args[0]),
        head = shaSchema.parse(args[1]);
      const dir = store.get().folders[repoKey(r)];
      if (!dir)
        throw new Error("Link this repository to a local folder first.");
      return projectChecks.start(
        prKey(r),
        dir,
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
    case "readClipboard":
      return clipboard.readText();
    case "readLocalFile":
    case "saveLocalFile": {
      const r = refSchema.parse(args[0]);
      const dir = store.get().folders[repoKey(r)];
      if (!dir)
        throw new Error("Link this repository to a local folder first.");
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
    case "askCodex": {
      const ref = refSchema.parse(args[0]),
        question = lineQuestionSchema.parse(args[1]);
      const dir = store.get().folders[repoKey(ref)];
      if (!dir) throw new Error("Link a local repository folder first.");
      const choice = aiSettingsSchema.parse(
        store.get().aiSettings ?? defaultAISettings,
      ).questions;
      await launchLineQuestion(
        requireClient(),
        dir,
        app.getPath("userData"),
        ref,
        question,
        choice,
      );
      return;
    }
    case "launchCodex": {
      const r = refSchema.parse(args[0]),
        dir = store.get().folders[repoKey(r)];
      if (!dir) throw new Error("Link a local repository folder first.");
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
    app.setName(experimentalCredentialName);
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
    rooms = new RoomService(
      store,
      (url, init) => net.fetch(url, init),
      async (value) => {
        const available =
          process.platform === "linux"
            ? safeStorage.isEncryptionAvailable() &&
              safeStorage.getSelectedStorageBackend() !== "basic_text"
            : await safeStorage.isAsyncEncryptionAvailable();
        return available
          ? (await safeStorage.encryptStringAsync(value)).toString("base64")
          : null;
      },
      async (value) =>
        (await safeStorage.decryptStringAsync(Buffer.from(value, "base64")))
          .result,
    );
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
          value: await dispatch(
            z.string().parse(method),
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
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Review Relay",
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
    // Keep the stable app as the reviewrelay: URL handler during this experiment.
    windowReady = true;
    createWindow();
    void restoreSavedLogin();
    app.on("activate", () => {
      if (!win) createWindow();
      else showWindow();
    });
  })
  .catch((e) => {
    dialog.showErrorBox("Review Relay could not start", e.message);
    app.quit();
  });
