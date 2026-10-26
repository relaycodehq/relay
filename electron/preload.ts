import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ApiMethod } from "../shared/types";
import type { RelayEvents } from "../shared/events";

/** Calls an Api method in the main process. */
async function invoke(method: ApiMethod, args: unknown[]) {
  const r = await ipcRenderer.invoke("relay:invoke", method, args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/**
 * Every Api method the main process handles, asked for once, so a new one
 * needs no change here and `window.relay` is there before the page runs.
 */
const methods = Object.fromEntries(
  (ipcRenderer.sendSync("relay:methods") as ApiMethod[]).map((method) => [
    method,
    (...args: unknown[]) => invoke(method, args),
  ]),
);

const subscribe =
  <T = unknown>(channel: string) =>
  (callback: (value: T) => void) => {
    const listener = (_event: unknown, value: T) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
const on = <C extends keyof RelayEvents>(channel: C) =>
  subscribe<RelayEvents[C]>(channel);
contextBridge.exposeInMainWorld("relay", {
  ...methods,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onProjectChat: on("relay:project-chat"),
  onProjectChats: on("relay:project-chats"),
  onThreadNews: on("relay:thread-news"),
  onProjectAdding: on("relay:project-adding"),
  onUpdate: subscribe("relay:update"),
  onDevBuild: subscribe("relay:dev-build"),
  onDictationState: subscribe("relay:dictation"),
  onReadAloudState: on("relay:read-aloud-state"),
  onReadAloud: on("relay:read-aloud"),
  onAgentVersions: subscribe("relay:agent-updates"),
  onRegistryAgents: subscribe("relay:acp-registry"),
  onAgentAccounts: subscribe("relay:agent-accounts"),
  onTerminal: subscribe("relay:terminal"),
  onPreview: on("relay:preview"),
  onPreviewReveal: on("relay:preview-reveal"),
  onPlaySound: on("relay:play-sound"),
  onDeviceHub: on("relay:device-hub"),
  onSchedules: on("relay:schedules"),
  onMaximized: subscribe<boolean>("relay:maximized"),
  onFullScreen: subscribe<boolean>("relay:full-screen"),
  onOpenUrl: subscribe<string>("relay:open-url"),
  onOpenProject: subscribe<string>("relay:open-project"),
  onThreadWindows: on("relay:thread-windows"),
  onEditorWindows: on("relay:editor-windows"),
  onEditorReturn: on("relay:editor-return"),
  onOpenThread: on("relay:open-thread"),
  onThreadMoved: on("relay:thread-moved"),
  onFlashWindow: on("relay:flash-window"),
  onMainWindowCommand: on("relay:main-command"),
  onSharedDraft: on("relay:shared-draft"),
  onDraftSend: on("relay:draft-send"),
  onBugReport: on("relay:bug-report"),
  onWorkingTree: on("relay:working-tree"),
  onElsewhere: on("relay:elsewhere"),
  onAutoCompact: on("relay:auto-compact"),
  onSettingsFile: on("relay:settings-file"),
  onLspDiagnostics: on("relay:lsp-diagnostics"),
  onLspInactiveLines: on("relay:lsp-inactive-lines"),
  onLspStatus: on("relay:lsp-status"),
  // Synchronous, once as the page starts: its first frame already uses the
  // file's fonts and theme instead of switching to them a moment later.
  settingsFileAtStart: () => ipcRenderer.sendSync("relay:settings-file-now"),
});

// Ports can't cross the context bridge; a window message can carry one.
ipcRenderer.on("relay:dictation-port", (event) => {
  window.postMessage(
    "relay:dictation-port",
    location.origin === "null" ? "*" : location.origin,
    event.ports,
  );
});
