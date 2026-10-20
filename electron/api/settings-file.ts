import { ipcMain, shell } from "electron";
import { z } from "zod";
import { settingsEditSchema } from "../../shared/settings-file";
import type { AppWindow } from "../app/window";
import type { SettingsFile } from "../settings";
import { openPath } from "./open-path";
import { takes, type ApiContext, type Handlers } from "./context";

/** settings.json: Settings' edits, and opening it to edit by hand. */
export function settingsFileHandlers(ctx: ApiContext) {
  return {
    updateSettingsFile: takes(
      [z.array(settingsEditSchema).min(1).max(50)],
      // Every window hears of it as the file changes.
      (edits) => ctx.settingsFile.update(edits),
    ),
    openSettingsFile: takes([], () => openPath(ctx.settingsFile.ensure())),
    revealSettingsFile: takes([], async () => {
      shell.showItemInFolder(await ctx.settingsFile.ensure());
    }),
  } satisfies Handlers;
}

/** Answers the preload's synchronous ask for the file as each page starts. */
export function serveSettingsFile(window: AppWindow, file: SettingsFile) {
  ipcMain.on("relay:settings-file-now", (event) => {
    event.returnValue = window.trusts(event) ? file.state() : null;
  });
}
