import { resolve } from "node:path";
import { callControl, type DaemonStatus, type ThreadRow } from "../control";
import {
  ago,
  bold,
  clip,
  colorful,
  cyan,
  dim,
  duration,
  green,
  ok,
  red,
  table,
  yellow,
} from "../format";
import { autoUpdateEnabled, running } from "../launch";
import { headlessPaths } from "../paths";
import { terminalQr } from "../qr";
import { indent, row, Screen, section } from "../terminal-ui";
import { installedService, serviceHome } from "../service";
import { agentName, type Flags, Usage } from "./args";
import {
  ensureRunning,
  reachWay,
  pipeOnly,
  reachProblem,
  needRunning,
} from "./daemon";
import { Quiet, pick, tilde, signIn, printJson } from "./util";
import { sleep } from "../../util/sleep";

// Pairing, and what the running Relay has: projects, threads, devices.

export async function status(home: string, flags: Flags) {
  const status = await running(home);
  const kind = installedService();
  const serviceHomeMatches = kind ? (await serviceHome(kind)) === home : false;
  if (flags.json)
    return printJson({
      running: !!status,
      service: kind && serviceHomeMatches ? kind : null,
      ...(status ? { status } : {}),
    });
  if (!status) {
    console.log(`${red("●")} Relay isn't running ${dim(`(${home})`)}`);
    console.log(
      kind && serviceHomeMatches
        ? `Its service is set up; start it with ${bold("relay start")}.`
        : `Start it with ${bold("relay start")}, or set it up with ${bold("relay setup")}.`,
    );
    return;
  }
  const { remote, threads } = status;
  const ui = new Screen();
  const head = `● Relay ${status.version}`;
  ui.print(
    `\n ${green("●")} ${bold(`Relay ${status.version}`)}${" ".repeat(Math.max(2, 44 - head.length))}${dim(`running for ${duration(Date.now() - status.startedAt)} · pid ${status.pid}`)}`,
  );

  ui.print(section("This computer"));
  ui.print(row("ok", "Name", dim(status.name)));
  ui.print(
    remote.listening
      ? row(
          "ok",
          "Reach",
          dim(`${remote.hosts.join(", ")}:${remote.port} ${reachWay(status)}`),
        )
      : remote.bound
        ? row("ok", "Reach", dim(pipeOnly(status)))
        : row("warn", "Reach", `not reachable: ${reachProblem(status)}`),
  );
  ui.print(row("ok", "Data", dim(tilde(status.home))));
  ui.print(
    kind && serviceHomeMatches
      ? row(
          "ok",
          "Service",
          dim(
            `${kind}, ${kind === "windows" ? "starts when you sign in" : "starts with the computer"}`,
          ),
        )
      : row(
          "off",
          "Service",
          "not set up; relay service install starts Relay with the computer",
        ),
  );
  const auto = await autoUpdateEnabled(home);
  ui.print(
    status.update.status === "off"
      ? row("off", "Updates", "built from source; git pull updates it")
      : status.update.status === "available"
        ? row(
            "warn",
            "Updates",
            auto
              ? `Relay ${status.update.version} is out; it installs once no thread is working`
              : `Relay ${status.update.version} is out; relay update installs it`,
          )
        : auto
          ? row("ok", "Updates", dim("installed by themselves"))
          : row("off", "Updates", "off; relay update installs one"),
  );

  ui.print(section("Paired"));
  for (const d of remote.devices) ui.print(deviceRow(d));
  if (!remote.devices.length)
    ui.print(
      row(
        "off",
        "Nothing yet",
        "relay pair shows a code for a phone or computer",
      ),
    );

  ui.print(section("Work"));
  ui.print(
    row(
      threads.waiting ? "warn" : "ok",
      "Threads",
      [
        threads.working ? cyan(`${threads.working} working`) : "",
        threads.waiting ? yellow(`${threads.waiting} waiting on you`) : "",
        dim(`${threads.total} in all`),
      ]
        .filter(Boolean)
        .join(dim(" · ")),
    ),
  );
  ui.print(
    row(
      status.projects ? "ok" : "off",
      "Projects",
      status.projects
        ? dim(String(status.projects))
        : "none yet; relay projects add <folder>",
    ),
  );

  ui.print(section("Agents"));
  if (!status.agents.length) ui.print(row("off", "Checking…"));
  const agents = status.agents.filter((a) => a.provider !== "cursor");
  for (const a of agents.filter((a) => a.path))
    ui.print(
      a.account && !a.account.signedIn
        ? row(
            "warn",
            agentName(a.provider),
            `signed out; sign in once with ${bold(signIn(a.provider))}`,
          )
        : row("ok", agentName(a.provider), dim(a.current ?? "")),
    );
  const missing = agents
    .filter((a) => !a.path)
    .map((a) => agentName(a.provider));
  if (missing.length) ui.print(row("off", "Not found", missing.join(", ")));
  ui.print("");
}

export async function pair(
  home: string,
  flags: Flags,
  waitForDevice = true,
  ui = new Screen(),
) {
  const status = await ensureRunning(home, flags);
  const control = headlessPaths(home).control;
  let pairing;
  try {
    pairing = await callControl(control, "pair", flags.pipe);
  } catch (e) {
    const fresh = await running(home);
    if (fresh && !fresh.remote.listening) {
      ui.print(section("Pair"));
      printTailscaleHelp(fresh, ui);
      throw new Quiet();
    }
    throw e;
  }
  if (flags.json)
    return printJson({ url: pairing.url, expiresAt: pairing.expiresAt });
  const known = new Set(status.remote.devices.map((d) => d.id));
  const until = new Date(pairing.expiresAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  ui.print(section("Pair"));
  // All of it goes once a device is in, or the code runs out.
  const code = ui.mark();
  ui.print(indent(terminalQr(pairing.url, { color: colorful }), 3));
  ui.print(
    `\n   Scan it in the ${bold("Relay")} app on your phone, or paste the link in\n   ${bold("Settings → Computers")} on another computer:\n`,
  );
  ui.print(`   ${cyan(pairing.url)}\n`);
  if (!waitForDevice || !ui.live) {
    ui.print(dim(`   It works once, until ${until}.`));
    return;
  }
  const spin = ui.spin(
    `Waiting for a phone or computer ${dim(`· works once, until ${until} · Ctrl-C stops waiting`)}`,
  );
  for (;;) {
    await sleep(1000);
    if (Date.now() > pairing.expiresAt) {
      spin.stop();
      ui.take(code);
      ui.print(
        row(
          "warn",
          "Expired",
          dim("the code ran out; relay pair makes a new one"),
        ),
      );
      return;
    }
    const now = await running(home).catch(() => null);
    const added = now?.remote.devices.find((d) => !known.has(d.id));
    if (added) {
      spin.stop();
      ui.take(code);
      ui.print(
        row(
          "ok",
          added.name,
          dim(
            added.kind === "computer"
              ? "computer · can hand threads here now"
              : "phone · its threads, approvals and questions reach it now",
          ),
        ),
      );
      return;
    }
  }
}

export function printTailscaleHelp(status: DaemonStatus, ui = new Screen()) {
  const { tailnet } = status.remote;
  const missing = tailnet.status === "missing";
  ui.print(
    row(
      "warn",
      "Tailscale",
      "phones and computers reach Relay over it, and this computer isn't on it yet",
    ),
  );
  const steps = [
    ...(missing
      ? [
          `Install Tailscale: ${process.platform === "linux" ? "curl -fsSL https://tailscale.com/install.sh | sh" : "https://tailscale.com/download"}`,
        ]
      : []),
    `Sign in to the same tailnet as your phone: ${bold("tailscale up")}`,
    `Run ${bold("relay pair")} again; Relay notices Tailscale within ten seconds.`,
  ];
  steps.forEach((step, i) => ui.print(`     ${dim(`${i + 1}.`)} ${step}`));
  if (status.remote.error)
    ui.print(dim(`     Relay said: ${status.remote.error}`));
}

export async function projects(
  home: string,
  flags: Flags,
  [action, ...args]: string[],
) {
  const control = headlessPaths(home).control;
  if (action === "add") {
    if (!args.length) throw new Usage("relay projects add <folder>");
    await ensureRunning(home, flags);
    for (const folder of args) {
      const project = await callControl(control, "addProject", resolve(folder));
      if (flags.json) printJson(project);
      else console.log(ok(`Added ${bold(project.name)} ${dim(project.path)}`));
    }
    return;
  }
  if (action === "remove" || action === "rm") {
    const query = args.join(" ");
    if (!query) throw new Usage("relay projects remove <name>");
    await needRunning(home);
    const list = await callControl(control, "projects");
    const project = pick(list, query, (p) => [p.id, p.name, p.path], "project");
    await callControl(control, "removeProject", project.id);
    console.log(
      ok(
        `Removed ${bold(project.name)}; its folder and threads stay, and adding it again brings them back.`,
      ),
    );
    return;
  }
  if (action)
    throw new Usage(`Unknown: relay projects ${action}. Try add or remove.`);
  await needRunning(home);
  const list = await callControl(control, "projects");
  if (flags.json) return printJson(list);
  if (!list.length)
    return console.log(
      `No projects yet. Add one with ${bold("relay projects add <folder>")}.`,
    );
  console.log(
    table(list.map((p) => [bold(p.name), p.path, dim(p.id.slice(0, 8))])),
  );
}

export async function threads(home: string, flags: Flags) {
  await needRunning(home);
  const rows = await callControl(headlessPaths(home).control, "threads");
  if (flags.json) return printJson(rows);
  const open = rows.filter((t) => t.state !== "settled");
  if (!open.length) return console.log("No open threads.");
  const width = Math.max(
    30,
    Math.min(60, (process.stdout.columns || 100) - 60),
  );
  console.log(
    table(
      open.map((t) => [
        stateMark(t),
        clip(t.title, width),
        dim(t.project),
        t.provider ? agentName(t.provider) : "",
        dim(ago(t.updated)),
      ]),
    ),
  );
  const settled = rows.length - open.length;
  if (settled)
    console.log(
      dim(`\n${settled} settled thread${settled === 1 ? "" : "s"} not shown.`),
    );
}

function stateMark(t: ThreadRow) {
  switch (t.state) {
    case "working":
      return cyan("● working");
    case "waiting":
      return yellow("◆ needs you");
    case "away":
      return dim(`→ on ${t.computer ?? "another computer"}`);
    default:
      return dim(t.computer ? `○ from ${t.computer}` : "○ idle");
  }
}

export async function devices(
  home: string,
  flags: Flags,
  [action, ...args]: string[],
) {
  const status = await needRunning(home);
  const control = headlessPaths(home).control;
  const list = status.remote.devices;
  if (action === "remove" || action === "rm") {
    const query = args.join(" ");
    if (!query) throw new Usage("relay devices remove <name>");
    const device = pick(list, query, (d) => [d.id, d.name], "paired device");
    await callControl(control, "removeDevice", device.id);
    console.log(
      ok(`Unpaired ${bold(device.name)}; it can't connect any more.`),
    );
    return;
  }
  if (action) throw new Usage(`Unknown: relay devices ${action}. Try remove.`);
  if (flags.json) return printJson(list);
  if (!list.length)
    return console.log(
      `Nothing is paired yet. Pair a phone with ${bold("relay pair")}.`,
    );
  console.log(
    table(
      list.map((d) => [
        bold(d.name),
        d.kind ?? "phone",
        d.online
          ? green("online")
          : d.lastSeen
            ? dim(`seen ${ago(d.lastSeen)}`)
            : dim("never seen"),
        d.app ? dim(`app ${d.app.version}`) : "",
        dim(d.id.slice(0, 8)),
      ]),
    ),
  );
}

export function deviceRow(d: DaemonStatus["remote"]["devices"][number]) {
  const seen = d.online
    ? green("online")
    : d.lastSeen
      ? `seen ${ago(d.lastSeen)}`
      : "never seen";
  return row(
    d.online ? "ok" : "off",
    d.name,
    dim(`${d.kind ?? "phone"} · `) + seen,
  );
}

export async function call(home: string, [method, ...args]: string[]) {
  if (!method) throw new Usage("relay call <method> [json arguments…]");
  await needRunning(home);
  const parsed = args.map((a) => {
    try {
      return JSON.parse(a) as unknown;
    } catch {
      return a;
    }
  });
  printJson(
    await callControl(headlessPaths(home).control, "call", method, parsed),
  );
}
