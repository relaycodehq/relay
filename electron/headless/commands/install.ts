import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { tailnetProbe } from "../../remote/tailscale";
import { callControl } from "../control";
import { bold, dim, green, ok, warn } from "../format";
import {
  readConfig,
  running,
  saveConfig,
  startDetached,
  stopped,
  stopForService,
} from "../launch";
import { headlessPaths } from "../paths";
import { row, Screen, section } from "../terminal-ui";
import {
  installService,
  installedService,
  serviceFile,
  serviceHome,
  stableNode,
  uninstallService,
} from "../service";
import { HeadlessUpdater, installRoot } from "../updater";
import { headlessVersion } from "../version";
import { keepDistributionsUp, wslDistro } from "../wsl";
import { errorMessage } from "../../../shared/error-message";
import { agentName, type Flags, Usage } from "./args";
import { remember, ensureRunning } from "./daemon";
import { pair, printTailscaleHelp, deviceRow } from "./remote";
import { script, confirm, tilde, signIn, printJson } from "./util";

// Installing Relay as a service, setting it up, updating and removing it.

export async function service(home: string, flags: Flags, [action]: string[]) {
  if (action === "install") {
    await stopForService(home);
    const { kind, file, note } = await installService({
      node: stableNode(),
      script,
      home,
      path: process.env.PATH ?? "",
    });
    console.log(ok(`Relay starts with the computer now (${kind}: ${file}).`));
    if (note) console.log(warn(note));
    return;
  }
  if (action === "uninstall") {
    const kind = await uninstallService();
    // launchd and systemd stop it as they let go; Windows has only the script.
    if (kind === "windows" && (await running(home))) {
      await callControl(headlessPaths(home).control, "stop", { detach: true });
      await stopped(home);
    }
    console.log(
      kind
        ? ok(
            `Relay no longer starts with the computer (${kind}). It isn't running now; relay start runs it until the next restart.`,
          )
        : "Relay wasn't set up as a service.",
    );
    return;
  }
  if (action && action !== "status")
    throw new Usage(
      `Unknown: relay service ${action}. Try install, uninstall or status.`,
    );
  const kind = installedService();
  if (flags.json)
    return printJson({
      service: kind,
      file: kind ? serviceFile(kind) : null,
      home: kind ? await serviceHome(kind) : null,
    });
  console.log(
    kind
      ? `Set up with ${kind} (${serviceFile(kind)}), for ${await serviceHome(kind)}.`
      : "Not set up as a service; relay service install does it.",
  );
}

export async function uninstall(home: string, flags: Flags) {
  const purge =
    flags.purge &&
    (!process.stdin.isTTY ||
      flags.yes ||
      (await confirm(
        `Delete ${home} too: threads, their worktrees with any uncommitted work, paired devices and settings?`,
      )));
  if (await running(home)) {
    await callControl(headlessPaths(home).control, "stop", {
      force: flags.force,
    });
    await stopped(home);
    console.log(ok("Relay stopped."));
  }
  const kind = await uninstallService();
  if (kind)
    console.log(ok(`Relay no longer starts with the computer (${kind}).`));
  const root = installRoot(__dirname);
  if (root) {
    await removeCommand(root);
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
    console.log(ok(`Removed Relay from ${root}.`));
  } else
    console.log(
      dim("This Relay runs from a build, not an install; its files stay."),
    );
  if (purge) {
    await rm(home, { recursive: true, force: true, maxRetries: 5 });
    console.log(ok(`Deleted ${home}.`));
  } else
    console.log(
      `Threads, worktrees and settings stay in ${bold(home)}; delete it to remove them too.`,
    );
}

/**
 * Takes `relay` off PATH where the installer put it: the user's Path on
 * Windows, the link in ~/.local/bin elsewhere. The desktop app's own
 * `relay` there is a file, not a link into the install, so it stays.
 */
async function removeCommand(root: string) {
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$bin = $env:RELAY_UNINSTALL_BIN.TrimEnd('\\')
$path = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($path) { [Environment]::SetEnvironmentVariable('Path', (($path -split ';') | Where-Object { $_ -and $_.TrimEnd('\\') -ne $bin }) -join ';', 'User') }`,
      ],
      {
        env: { ...process.env, RELAY_UNINSTALL_BIN: join(root, "bin") },
        stdio: "ignore",
        windowsHide: true,
      },
    );
    return;
  }
  const real = await realpath(root);
  for (const dir of new Set([
    process.env.RELAY_BIN,
    join(homedir(), ".local", "bin"),
  ])) {
    if (!dir) continue;
    const link = join(dir, "relay");
    if (!(await lstat(link).catch(() => null))?.isSymbolicLink()) continue;
    const target = await realpath(link).catch(() => "");
    if (target.startsWith(real + sep)) await rm(link, { force: true });
  }
}

/**
 * In WSL, which stops the distribution 15 s after the last Windows program
 * using it exits, and Relay with it. A Windows Relay that works in this
 * distribution holds it awake; without one, `.wslconfig` can turn the timeout
 * off, for every distribution, which is why it's off unless asked for.
 */
async function setUpWsl(ui: Screen, distro: string) {
  if (
    !(await ui.ask(
      `Keep WSL running while Windows is on? Only needed when no Relay on Windows works in ${distro}: WSL stops it 15 seconds after its last window closes. This sets instanceIdleTimeout=-1 in .wslconfig, which keeps every WSL distribution running, and applies from WSL's next start.`,
      false,
    ))
  )
    return ui.print(
      row(
        "off",
        "WSL",
        "stops 15 s after its last window closes, unless a Relay on Windows holds it",
      ),
    );
  try {
    const file = await keepDistributionsUp();
    ui.print(
      row(
        "ok",
        "WSL",
        dim(
          file
            ? `stays running from WSL's next start (${file})`
            : "stays running",
        ),
      ),
    );
  } catch (e) {
    ui.print(
      row(
        "warn",
        "WSL",
        `couldn't reach Windows (${errorMessage(e)}); set instanceIdleTimeout=-1 under [general] in %USERPROFILE%\\.wslconfig yourself`,
      ),
    );
  }
}

export async function setup(home: string, flags: Flags) {
  const ui = new Screen(process.stdout, process.stdin, !flags.yes);
  ui.print(
    `\n${bold(` Relay ${headlessVersion}`)}${" ".repeat(Math.max(2, 46 - headlessVersion.length))}${dim(tilde(home))}`,
  );

  ui.print(section("This computer"));
  ui.print(
    // Before 22.3 there's no getBuiltinModule to ask with either.
    process.getBuiltinModule?.("node:sqlite")
      ? row("ok", "Node.js", dim(process.versions.node))
      : row(
          "warn",
          "Node.js",
          `${process.versions.node} has no node:sqlite, so a restart forgets running turns; 22.13 or newer has it`,
        ),
  );
  const git = gitVersion();
  ui.print(
    git
      ? row("ok", "Git", dim(git.replace(/^git version /, "")))
      : row(
          "fail",
          "Git",
          "not installed; threads in worktrees and handoffs need it",
        ),
  );
  let spin = ui.spin("Looking for Tailscale…");
  const tailnet = await tailnetProbe()(true);
  spin.stop();
  ui.print(
    tailnet.status === "connected"
      ? row(
          "ok",
          "Tailscale",
          dim([tailnet.name, ...tailnet.addresses].filter(Boolean).join(" · ")),
        )
      : row(
          "warn",
          "Tailscale",
          tailnet.status === "missing"
            ? "not installed; phones and computers reach Relay over it. Install it and sign in with tailscale up"
            : "off; run tailscale up and Relay picks it up within ten seconds",
        ),
  );
  await remember(home, flags);

  // Started with the computer, unless asked not to.
  const already = await running(home);
  if (
    flags.service &&
    (await ui.ask("Start Relay with this computer, in the background?", true))
  ) {
    spin = ui.spin("Setting up the background service…");
    await stopForService(home);
    const { kind, note } = await installService({
      node: stableNode(),
      script,
      home,
      path: process.env.PATH ?? "",
    });
    spin.stop();
    ui.print(
      row("ok", "Background", dim(`starts with the computer (${kind})`)),
    );
    if (note) ui.print(row("warn", "", note));
  } else if (!already) {
    spin = ui.spin("Starting Relay…");
    await startDetached(home, script);
    spin.stop();
    ui.print(row("ok", "Background", dim("runs until this computer restarts")));
  } else
    ui.print(
      row(
        "ok",
        "Background",
        dim("running; relay service install starts it with the computer"),
      ),
    );
  const distro = wslDistro();
  if (distro) await setUpWsl(ui, distro);
  // An installed release keeps itself current unless told not to.
  if (installRoot(__dirname)) {
    const autoUpdate = await ui.ask(
      "Install Relay's updates by themselves, once no thread is working?",
      (await readConfig(home)).autoUpdate ?? true,
    );
    await saveConfig(home, { autoUpdate });
    ui.print(
      autoUpdate
        ? row("ok", "Updates", dim("by themselves, once no thread is working"))
        : row("off", "Updates", "off; relay update installs one"),
    );
  }
  let status = await running(home);
  if (!status) {
    spin = ui.spin("Starting Relay…");
    status = await ensureRunning(home, flags, true);
    spin.stop();
  }

  ui.print(section("Agents"));
  const agents = (
    status.agents.length ? status.agents : ((await running(home))?.agents ?? [])
  ).filter((a) => a.provider !== "cursor");
  for (const agent of agents) {
    const name = agentName(agent.provider);
    if (!agent.path) continue;
    ui.print(
      agent.account && !agent.account.signedIn
        ? row(
            "warn",
            name,
            `signed out; sign in once with ${bold(signIn(agent.provider))}`,
          )
        : row("ok", name, dim(agent.current ?? "")),
    );
  }
  const missing = agents
    .filter((a) => !a.path)
    .map((a) => agentName(a.provider));
  if (missing.length) ui.print(row("off", "Not found", missing.join(", ")));
  if (!agents.some((a) => a.path))
    ui.print(
      row(
        "warn",
        "No agent",
        "install Claude Code, Codex or OpenCode and sign in once, as the user Relay runs as",
      ),
    );

  ui.print(section("Projects"));
  const control = headlessPaths(home).control;
  for (const folder of flags.projects)
    await callControl(control, "addProject", resolve(folder));
  let list = await callControl(control, "projects");
  const here = process.cwd();
  if (
    !flags.projects.length &&
    !list.some((p) => p.path === here) &&
    existsSync(join(here, ".git")) &&
    (await ui.ask(`Add ${bold(tilde(here))} as a project?`, false))
  ) {
    await callControl(control, "addProject", here);
    list = await callControl(control, "projects");
  }
  for (const p of list) ui.print(row("ok", p.name, dim(tilde(p.path))));
  if (!list.length)
    ui.print(
      row(
        "off",
        "None yet",
        "relay projects add <folder>; a thread handed over needs its repository cloned here",
      ),
    );

  const fresh = (await running(home))!;
  if (fresh.remote.devices.length) {
    ui.print(section("Paired"));
    for (const d of fresh.remote.devices) ui.print(deviceRow(d));
  } else if (!fresh.remote.listening) {
    ui.print(section("Pair"));
    printTailscaleHelp(fresh, ui);
  } else if (flags.pair && ui.live) await pair(home, flags, true, ui);
  else {
    ui.print(section("Pair"));
    ui.print(
      row("off", "Not yet", "relay pair shows a code for a phone or computer"),
    );
  }
  ui.print(
    `\n ${green("Done.")} ${bold("relay status")} ${dim("shows how it's doing,")} ${bold("relay pair")} ${dim("adds a device")}\n       ${dim("and")} ${bold("relay settings")} ${dim("sets up dictation, read aloud, Cursor and Gitea.")}`,
  );
}

export async function update(home: string, flags: Flags) {
  const root = installRoot(__dirname);
  if (!root)
    throw new Error(
      `This Relay runs from a build in ${resolve(__dirname, "..")}; update it with git pull and npm run build:headless.`,
    );
  // A running daemon owns its update and restart. Standalone installs use
  // the same installation lock as the daemon (including other Relay homes).
  const daemon = await running(home);
  const updater = daemon
    ? undefined
    : new HeadlessUpdater(root, headlessVersion);
  const result = daemon
    ? await callControl(headlessPaths(home).control, "update", flags.check)
    : flags.check
      ? await updater!.check()
      : await updater!.install();
  if (result.status === "error") throw new Error(result.message);
  if (flags.json) return printJson(result);
  if (result.status === "available" || result.status === "ready") {
    console.log(
      `Relay ${bold(result.version)} is out; ${bold("relay update")} installs it.`,
    );
  } else if (result.status === "installing") {
    console.log(
      ok(
        `Relay ${result.version} is installed in ${root}.${daemon ? " Restarting Relay; agents carry on." : ""}`,
      ),
    );
  } else if (result.status === "idle") {
    console.log(ok(`Relay ${result.current} is the newest.`));
  } else {
    throw new Error(
      `Relay update did not finish (${result.status}); try again.`,
    );
  }
}

function gitVersion() {
  try {
    return execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}
