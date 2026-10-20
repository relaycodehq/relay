import { BrowserWindow, ipcMain } from "electron";
import { z } from "zod";
import type { ApiMethod } from "../../shared/types";
import { callFrom, type AppWindow } from "../app/window";
import { accountHandlers } from "./account";
import { agentToolHandlers } from "./agent-tools";
import { accountHandlers as agentAccountHandlers } from "./accounts";
import { chatHandlers } from "./chats";
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
import { projectHandlers } from "./projects";
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
import { previewHandlers } from "./previews";
import { processHandlers } from "./processes";
import { usageHandlers } from "./usage";

export type Dispatch = (method: ApiMethod, args: unknown[]) => Promise<unknown>;

/** Runs an Api call; its arguments come from the renderer or the phone, so every handler parses them. */
export function createDispatch(ctx: ApiContext): Dispatch {
  const handlers = combine([
    accountHandlers(ctx),
    agentAccountHandlers(ctx),
    agentToolHandlers(ctx),
    reviewHandlers(ctx),
    reviewCheckoutHandlers(ctx),
    checkHandlers(ctx),
    projectHandlers(ctx),
    gitHandlers(ctx),
    elsewhereHandlers(ctx),
    chatHandlers(ctx),
    terminalHandlers(ctx),
    threadWindowHandlers(ctx),
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
    bugReportHandlers(ctx),
    // Fails to compile when the Api gains a method no domain handles.
  ]) satisfies Required<Handlers>;
  return async (method, args) => {
    // Own keys only: names the renderer made up, "toString" among them, stay unknown.
    if (!Object.hasOwn(handlers, method))
      throw new Error(`Unknown application method: ${String(method)}.`);
    const handler = handlers[method] as (args: unknown[]) => unknown;
    // A thread live on another computer runs there.
    const sender = ctx.handoffs()?.sender;
    if (sender?.forwards(method, args))
      return sender.forward(method, args, () => handler(args));
    return handler(args);
  };
}

export function serveApi(window: AppWindow, dispatch: Dispatch) {
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
