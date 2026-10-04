import { readFile } from "node:fs/promises";
import { release } from "node:os";
import { join } from "node:path";
import {
  app,
  crashReporter,
  dialog,
  shell,
  type BrowserWindow,
  type RenderProcessGoneDetails,
} from "electron";
import { releasesRepo } from "../../shared/updates";
import { issueUrl, type Occasion } from "./issue";
import { trackRun, type LastRun } from "./last-run";

export type { LastRun };

/**
 * Starts collecting native crash dumps and marks this run as started. Call
 * once Relay knows it's the only copy running, as early as it can.
 */
export function watchForCrashes() {
  // Dumps stay on this computer; a report only says that one exists.
  crashReporter.start({ uploadToServer: false });
  const run = trackRun(
    app.getPath("userData"),
    app.getVersion(),
    app.getPath("crashDumps"),
  );
  app.on("will-quit", run.quit);
  // Test runs and development restarts end however they like.
  const ask =
    !process.env.RELAY_TEST_DATA &&
    (app.isPackaged || process.env.RELAY_CRASH_PROMPT === "1");
  return ask ? run.last : null;
}

/** Opens a new issue on GitHub with the log filled in, for the user to finish. */
export async function reportBug(occasion: Occasion = { kind: "asked" }) {
  const logs = app.getPath("logs");
  const read = (name: string) =>
    readFile(join(logs, name), "utf8").catch(() => "");
  const [old, current] = await Promise.all([
    read("main.old.log"),
    read("main.log"),
  ]);
  await shell.openExternal(
    issueUrl({
      repo: releasesRepo,
      occasion,
      about: about(),
      log: old + current,
    }),
  );
}

/**
 * Asks before the rest of startup runs, so a launch that crashes again can
 * still be reported.
 */
export async function offerCrashReport(last: LastRun) {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message:
      last.crashes > 1
        ? `Relay quit unexpectedly ${last.crashes} times in a row.`
        : "Relay quit unexpectedly last time.",
    detail:
      "Report it on GitHub? Relay opens a new issue with its log filled in, secrets removed, and you see all of it before anything is sent.",
    buttons: ["Report on GitHub…", "Not Now"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0)
    await reportBug({
      kind: "quit",
      at: last.startedAt,
      dump: last.dump,
    }).catch((e) => console.warn("Could not open the bug report:", e));
}

/** The window went blank; offer to bring it back and to report it. */
export async function offerWindowReport(
  win: BrowserWindow,
  { reason, exitCode }: RenderProcessGoneDetails,
) {
  console.error(`Window process gone: ${reason}, exit code ${exitCode}`);
  // Relay quitting or closing the window isn't something to report.
  if (reason === "clean-exit" || win.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(win, {
    type: "error",
    message: "Relay's window crashed.",
    detail: `Its process ended (${reason}). Your threads are saved; reloading brings the window back.`,
    buttons: ["Reload", "Report on GitHub…", "Close"],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 2) return;
  if (response === 1)
    await reportBug({ kind: "window", reason, exitCode }).catch((e) =>
      console.warn("Could not open the bug report:", e),
    );
  if (!win.isDestroyed()) win.webContents.reload();
}

function about() {
  const os =
    process.platform === "darwin"
      ? `macOS ${process.getSystemVersion()}`
      : process.platform === "win32"
        ? `Windows ${process.getSystemVersion()}`
        : `Linux ${release()}`;
  return `Relay ${app.getVersion()} · ${os} ${process.arch} · Electron ${process.versions.electron}`;
}
