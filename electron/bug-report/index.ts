import { execFile, execFileSync } from "node:child_process";
import { hostname, release, totalmem, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  app,
  clipboard,
  crashReporter,
  dialog,
  powerMonitor,
  shell,
  type BrowserWindow,
  type RenderProcessGoneDetails,
} from "electron";
import { agentName } from "../../shared/agents";
import type { AgentVersion } from "../../shared/agent-updates";
import type {
  BugReportFields,
  BugReportOccasion,
} from "../../shared/bug-report";
import type { Project } from "../../shared/projects";
import type { AISettings } from "../../shared/settings";
import { releasesRepo } from "../../shared/updates";
import { computerName } from "../platform/computer-name";
import { findExecutable } from "../platform/executables";
import type { GithubLogin } from "../pull-requests/github-login";
import { performanceFacts, setUpPerformance } from "../perf";
import { keepCrashedRunLog } from "./crash-log";
import { DragTray } from "./drag-tray";
import { trackRun, type LastRun } from "./last-run";
import { BugReports } from "./service";
import { execGh, issueHost } from "./submit";
import { defaultWriter, writeUp } from "./write-up";

export type { LastRun };
export { BugReports };

const exec = promisify(execFile);
let reports: BugReports | undefined;
let tray: DragTray | undefined;
let show: (() => void) | undefined;

/**
 * Starts collecting native crash dumps and marks this run as started. Call
 * once Relay knows it's the only copy running, as early as it can, after the
 * log's line for this run's start.
 */
export function watchForCrashes() {
  // Dumps stay on this computer; a report only says that one exists.
  crashReporter.start({ uploadToServer: false });
  const run = trackRun(
    app.getPath("userData"),
    app.getVersion(),
    app.getPath("crashDumps"),
  );
  // Before this run's logging can rotate it away.
  if (run.last) keepCrashedRunLog(app.getPath("logs"), run.last.startedAt);
  app.on("will-quit", run.quit);
  // Being told to stop isn't quitting unexpectedly, even when the system
  // kills Relay before its quit finishes. A hung Relay can't answer these.
  void app.whenReady().then(() => {
    powerMonitor.on("shutdown", run.quit);
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.on(signal, run.quit);
  });
  // Test runs and development restarts end however they like.
  const ask =
    !process.env.RELAY_TEST_DATA &&
    (app.isPackaged || process.env.RELAY_CRASH_PROMPT === "1");
  return ask ? run.last : null;
}

/** The report page's service, made once Relay knows its projects and agents. */
export function setUpBugReports(deps: {
  github: GithubLogin;
  projects: () => Project[];
  agents: () => AgentVersion[];
  aiSettings: () => AISettings;
  /** Brings a window up on the report page. */
  show: () => void;
  /** Lets a helper window of Relay's own call the API. */
  trustHelper: (win: BrowserWindow) => void;
}) {
  show = deps.show;
  tray = new DragTray(deps.trustHelper);
  const performance = setUpPerformance();
  reports = new BugReports(
    {
      dir: join(app.getPath("userData"), "bug-report"),
      logs: app.getPath("logs"),
      repo: releasesRepo,
      system: () => systemInfo(deps.agents()),
      identity: () => ({
        home: app.getPath("home"),
        user: safeUserName(),
        hosts: [
          hostname(),
          hostname().replace(/\.local$/, ""),
          computerName(),
          ...macNames(),
        ],
        relayData: app.getPath("userData"),
        projects: deps.projects().map((p) => ({
          path: p.path,
          ...(p.repository
            ? { repo: `${p.repository.owner}/${p.repository.name}` }
            : {}),
        })),
      }),
      host: async () => issueHost(await deps.github.require()),
      gh: () => findExecutable("gh").catch(() => null),
      exec: execGh,
      writeUp: (writer, text, kind, seen) =>
        writeUp(writer, text, kind, seen, AbortSignal.timeout(180_000)),
      defaultWriter: () => {
        const ai = deps.aiSettings();
        return defaultWriter(
          deps.agents().flatMap((a) => (a.current ? [a.provider] : [])),
          { provider: ai.commitMessageProvider, choice: ai.commitMessage },
        );
      },
      performance: {
        facts: async () =>
          performanceFacts(
            await performance.samples(),
            await performance.snapshot().catch(() => undefined),
          ),
        logText: performance.logText,
        record: performance.record,
      },
    },
    {
      openExternal: (url) => shell.openExternal(url),
      reveal: (path) => shell.showItemInFolder(path),
      offerDrag: (files) =>
        void tray
          ?.offer(files)
          .catch((e) => console.warn("Could not show the files to drag:", e)),
      copy: (text) => clipboard.writeText(text),
      downloads: app.getPath("downloads"),
    },
  );
  return reports;
}

/** The tray of files to drag into GitHub, while Relay's window is up. */
export function dragTray() {
  if (!tray) throw new Error("Relay is still starting.");
  return tray;
}

/** Shows the report page, noting what made Relay offer it. */
export async function reportBug(
  occasion: BugReportOccasion = { kind: "asked" },
) {
  if (!reports) throw new Error("Relay is still starting.");
  await reports.begin(occasion);
  reports.want();
  show?.();
}

/** Fills a new report with an agent's write-up and shows the page. */
export async function draftBugReport(
  fields: Pick<BugReportFields, "kind" | "title" | "description">,
) {
  if (!reports) throw new Error("Relay is still starting.");
  await reports.prefill(fields);
  reports.want();
  show?.();
}

/**
 * Asks before the rest of startup runs, so a launch that crashes again can
 * still be reported; the page itself shows once the window is up.
 */
export async function offerCrashReport(last: LastRun) {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message:
      last.crashes > 1
        ? `Relay quit unexpectedly ${last.crashes} times in a row.`
        : "Relay quit unexpectedly last time.",
    detail:
      "Tell us what happened? Relay kept that run's log. You write the report, see everything it would send, and nothing leaves this computer until you press Send.",
    buttons: ["Report a Problem…", "Not Now"],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0
    ? ({ kind: "quit", at: last.startedAt, dump: last.dump } as const)
    : null;
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
    buttons: ["Reload", "Reload and Report…", "Close"],
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

let names: string[] | undefined;
/**
 * The Mac's names besides its host name: "Jana's MacBook Pro" as Sharing
 * shows it, and the Bonjour name. Either can turn up in a log.
 */
function macNames() {
  if (process.platform !== "darwin") return [];
  names ??= ["ComputerName", "LocalHostName"].flatMap((key) => {
    try {
      const name = execFileSync("scutil", ["--get", key], {
        encoding: "utf8",
        timeout: 2000,
      }).trim();
      return name ? [name] : [];
    } catch {
      return [];
    }
  });
  return names;
}

function safeUserName() {
  try {
    return userInfo().username;
  } catch {
    return "";
  }
}

async function systemInfo(agents: AgentVersion[]) {
  const os =
    process.platform === "darwin"
      ? `macOS ${process.getSystemVersion()}`
      : process.platform === "win32"
        ? `Windows ${process.getSystemVersion()}`
        : `Linux ${release()}`;
  const home = app.getPath("home");
  const tilde = (path: string) =>
    path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    os,
    arch: process.arch,
    translated: app.runningUnderARM64Translation,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    memoryGb: Math.round(totalmem() / 2 ** 30),
    // Paths are anonymized with the rest of the facts.
    agents: agents.map((a) => ({
      id: a.provider,
      name: agentName(a.provider),
      version: a.current ?? null,
      ...(a.path ? { path: a.path } : {}),
      ...(a.installer ? { how: a.installer } : {}),
      ...(a.linked ? { linked: true } : {}),
    })),
    gh: await ghVersion(),
    appPath: tilde(
      app
        .getAppPath()
        .replace(/[\\/]Contents[\\/]Resources[\\/]app\.asar$/, ""),
    ),
    dataPath: tilde(app.getPath("userData")),
  };
}

async function ghVersion() {
  try {
    const gh = await findExecutable("gh");
    const { stdout } = await exec(gh, ["--version"], { timeout: 5000 });
    return /\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? null;
  } catch {
    return null;
  }
}
