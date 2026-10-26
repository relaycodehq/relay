import { BrowserWindow, ipcMain } from "electron";
import { z } from "zod";
import type { ApiMethod } from "../../shared/types";
import { callFrom, type AppWindow } from "../app/window";
import { accountHandlers } from "./account";
import { openCodeHandlers } from "./opencode";
import { agentToolHandlers } from "./agent-tools";
import { accountHandlers as agentAccountHandlers } from "./accounts";
import { chatHandlers } from "./chats";
import { deepReviewHandlers } from "./deep-reviews";
import { bugReportHandlers } from "./bug-reports";
import { checkHandlers } from "./checks";
import { combine } from "./combine";
import { computerHandlers } from "./computers";
import type { ApiContext, Handlers } from "./context";
import { desktopHandlers } from "./desktop";
import { draftHandlers } from "./drafts";
import { deviceHandlers } from "./devices";
import { gitHandlers } from "./git";
import { elsewhereHandlers } from "./elsewhere";
import { languageServerHandlers } from "./language-servers";
import { localHistoryHandlers } from "./local-history";
import { projectHandlers } from "./projects";
import { projectSearchHandlers } from "./project-search";
import { readAloudHandlers } from "./read-aloud";
import { renderHandlers } from "./renders";
import { reviewCheckoutHandlers } from "./review-checkout";
import { reviewHandlers } from "./reviews";
import { pluginHandlers } from "./plugins";
import { settingsHandlers } from "./settings";
import { settingsFileHandlers } from "./settings-file";
import { soundHandlers } from "./sounds";
import { memeHandlers } from "./memes";
import { terminalHandlers } from "./terminals";
import { threadWindowHandlers } from "./thread-windows";
import { editorWindowHandlers } from "./editor-windows";
import { previewHandlers } from "./previews";
import { processHandlers } from "./processes";
import { scheduleHandlers } from "./schedules";
import { secondOpinionHandlers } from "./second-opinions";
import { usageHandlers } from "./usage";

export type Dispatch = (method: ApiMethod, args: unknown[]) => Promise<unknown>;

/** Runs an Api call; its arguments come from the renderer or the phone, so every handler parses them. */
export function createDispatch(
  ctx: ApiContext,
): Dispatch & { methods: string[] } {
  const handlers = combine([
    accountHandlers(ctx),
    openCodeHandlers(),
    agentAccountHandlers(ctx),
    agentToolHandlers(ctx),
    reviewHandlers(ctx),
    reviewCheckoutHandlers(ctx),
    checkHandlers(ctx),
    projectHandlers(ctx),
    languageServerHandlers(ctx),
    localHistoryHandlers(ctx),
    projectSearchHandlers(ctx),
    gitHandlers(ctx),
    elsewhereHandlers(ctx),
    chatHandlers(ctx),
    deepReviewHandlers(ctx),
    secondOpinionHandlers(ctx),
    terminalHandlers(ctx),
    threadWindowHandlers(ctx),
    editorWindowHandlers(ctx),
    previewHandlers(ctx),
    deviceHandlers(ctx),
    settingsHandlers(ctx),
    settingsFileHandlers(ctx),
    readAloudHandlers(ctx),
    renderHandlers(ctx),
    soundHandlers(ctx),
    memeHandlers(ctx),
    pluginHandlers(ctx),
    desktopHandlers(ctx),
    draftHandlers(ctx),
    computerHandlers(ctx),
    usageHandlers(ctx),
    processHandlers(ctx),
    scheduleHandlers(ctx),
    bugReportHandlers(ctx),
    // Fails to compile when the Api gains a method no domain handles.
  ]) satisfies Required<Handlers>;
  const dispatch: Dispatch = async (method, args) => {
    // Own keys only: names the renderer made up, "toString" among them, stay unknown.
    if (!Object.hasOwn(handlers, method))
      throw new Error(`Unknown application method: ${String(method)}.`);
    const handler = handlers[method] as (args: unknown[]) => unknown;
    // A thread live on another computer runs there.
    const sender = ctx.handoffs()?.sender;
    if (sender?.forwards(method, args))
      return sender.forward(method, args, () => handler(args));
    // So does the folder of a project that lives on one.
    const remote = ctx.handoffs()?.remote;
    if (remote?.forwards(method, args))
      return remote.forward(method, args, () => handler([null]));
    return handler(args);
  };
  return Object.assign(dispatch, { methods: Object.keys(handlers) });
}

export function serveApi(
  window: AppWindow,
  dispatch: Dispatch & { methods: string[] },
) {
  // The preload script builds `window.relay` from these before the page runs.
  ipcMain.on("relay:methods", (event) => {
    event.returnValue = dispatch.methods;
  });
  ipcMain.handle("relay:invoke", async (event, method, args) => {
    if (!window.trusts(event)) throw new Error("Untrusted IPC sender");
    try {
      return {
        ok: true,
        // Unknown names fall through to dispatch's own error. Handlers that
        // act on a window act on the one this call came from.
        value: await callFrom(BrowserWindow.fromWebContents(event.sender), () =>
          dispatch(
            z.string().parse(method) as ApiMethod,
            z.array(z.unknown()).max(10).parse(args),
          ),
        ),
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Unexpected error",
      };
    }
  });
}
