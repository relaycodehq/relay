import { contextBridge, ipcRenderer } from "electron";
const methods = [
  "inspectSymbol",
  "projectCheckInfo",
  "projectCheckState",
  "startProjectChecks",
  "stopProjectChecks",
  "updateCheckBuffer",
  "triageState",
  "startTriage",
  "cancelTriage",
  "groupPaths",
  "bootstrap",
  "retryLoginRestore",
  "cancelLoginRestore",
  "saveWorkspace",
  "connect",
  "disconnect",
  "search",
  "pull",
  "files",
  "contents",
  "blame",
  "reviews",
  "reviewComments",
  "discussion",
  "progress",
  "saveProgress",
  "submitReview",
  "reply",
  "resolveComment",
  "comment",
  "folder",
  "linkFolder",
  "readLocalFile",
  "saveLocalFile",
  "readClipboard",
  "launchCodex",
  "askCodex",
  "aiSettings",
  "saveAISettings",
  "openExternal",
  "parseUrl",
];
const api = Object.fromEntries(
  methods.map((method) => [
    method,
    async (...args: unknown[]) => {
      const r = await ipcRenderer.invoke("relay:invoke", method, args);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    },
  ]),
);
contextBridge.exposeInMainWorld("relay", {
  ...api,
  onOpenUrl: (callback: (url: string) => void) => {
    const listener = (_event: unknown, url: string) => callback(url);
    ipcRenderer.on("relay:open-url", listener);
    return () => ipcRenderer.removeListener("relay:open-url", listener);
  },
});
