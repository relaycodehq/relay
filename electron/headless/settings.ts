// `relay settings`: what the desktop's Settings sets up, for a Relay with
// no window. In a terminal it's a menu; `relay settings set <key> <value>`
// and the subcommands do the same from a script. Everything changes in the
// running Relay through the desktop's own calls and their validation.
import { createInterface, type Interface } from "node:readline/promises";
import type { AgentVersion } from "../../shared/agent-updates";
import {
  runnableAgents,
  agentInfo,
  type AgentProvider,
} from "../../shared/agents";
import { dictationModelSize } from "../../shared/dictation";
import { readAloudSpeeds } from "../../shared/read-aloud";
import type { Account } from "../../shared/types";
import type { UpdateState } from "../../shared/updates";
import { watchScopes, type WatchScope } from "../../shared/watch";
import type { GitInfo } from "../../shared/working-tree";
import { callControl } from "./control";
import { bold, colorful, cyan, dim, green, ok, warn, yellow } from "./format";
import { readConfig, saveConfig } from "./launch";
import { headlessPaths } from "./paths";
import { terminalQr } from "./qr";
import type { SpeechEngine, SpeechState } from "./speech";

export interface SettingsContext {
  home: string;
  json: boolean;
  /** Restarts the running Relay, for what it only reads as it starts. */
  restart(): Promise<void>;
}

/** Everything `relay settings` shows, read from the running Relay at once. */
export interface Snapshot {
  name: string;
  port: number;
  /** Installs releases as they come out; see ./auto-update. */
  autoUpdate: boolean;
  /** Where updates stand; "off" for a build from source, which git updates. */
  update: UpdateState;
  keepAwake: boolean;
  autoSettleDays: number | null;
  worktreeCleanupDays: number | null;
  newThreadAgent: AgentProvider | null;
  watchThreads: WatchScope;
  agents: AgentVersion[];
  git: GitInfo;
  gitea: Account | null;
  speech: SpeechState;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const megabytes = (bytes: number) =>
  `${Math.round(bytes / 1_000_000).toLocaleString("en")} MB`;
const cliName = (provider: string) =>
  agentInfo(provider as AgentProvider)?.cli ?? provider;

function control(ctx: SettingsContext) {
  return headlessPaths(ctx.home).control;
}

/** A call the desktop's window would make, through the running Relay. */
function call<T>(ctx: SettingsContext, method: string, ...args: unknown[]) {
  return callControl(control(ctx), "call", method, args) as Promise<T>;
}

export async function snapshot(ctx: SettingsContext): Promise<Snapshot> {
  const [
    status,
    config,
    keepAwake,
    autoSettleDays,
    worktreeCleanupDays,
    newThreadAgent,
    watchThreads,
    git,
    boot,
    speech,
  ] = await Promise.all([
    callControl(control(ctx), "status"),
    readConfig(ctx.home),
    call<boolean>(ctx, "keepAwake"),
    call<number | null>(ctx, "autoSettleDays"),
    call<number | null>(ctx, "worktreeCleanupDays"),
    call<AgentProvider | null>(ctx, "newThreadAgent"),
    call<WatchScope>(ctx, "watchThreads"),
    call<GitInfo>(ctx, "gitInfo"),
    call<{ account: Account | null }>(ctx, "bootstrap"),
    callControl(control(ctx), "speech"),
  ]);
  return {
    // What's saved, which a restart puts to use.
    name: config.name ?? status.name,
    port: config.port ?? status.remote.port,
    autoUpdate: config.autoUpdate ?? true,
    update: status.update,
    keepAwake,
    autoSettleDays,
    worktreeCleanupDays,
    newThreadAgent,
    watchThreads,
    agents: status.agents,
    git,
    gitea: boot.account,
    speech,
  };
}

// ── What each setting shows ────────────────────────────────────────────

const days = (n: number | null, zero = "right away") =>
  n === null ? "never" : n === 0 ? zero : `after ${n} day${n === 1 ? "" : "s"}`;
const watchLabels: Record<WatchScope, string> = {
  off: "off",
  main: "the main thread",
  subagents: "the main thread and its subagents",
};

function agentValue(agent: AgentVersion | undefined) {
  if (!agent?.path) return dim("not found");
  const account = agent.account
    ? agent.account.signedIn
      ? green(
          agent.account.email
            ? `signed in as ${agent.account.email}`
            : "signed in",
        )
      : yellow("signed out")
    : "";
  return [
    agent.current,
    account,
    dim(agent.path + (agent.linked ? " (set here)" : "")),
  ]
    .filter(Boolean)
    .join("  ");
}

function cursorValue(agent: AgentVersion | undefined) {
  if (!agent?.current) return dim("not set up");
  return agent.account?.signedIn
    ? green(
        agent.account.email
          ? `signed in as ${agent.account.email}`
          : "signed in",
      )
    : yellow("signed out");
}

function dictationValue({ dictation }: SpeechState) {
  if (!dictation.supported) return dim("not available on this computer");
  if (!dictation.engine)
    return dim(`not set up (${megabytes(dictationModelSize)} model)`);
  const model = dictation.model;
  if (model.status === "ready") return green("ready");
  if (model.status === "downloading")
    return `downloading, ${Math.round((model.received / model.total) * 100)}%`;
  if (model.status === "failed") return yellow(`failed: ${model.error}`);
  return dim("model not downloaded");
}

function voiceValue({ voice }: SpeechState) {
  if (!voice.supported) return dim("not available on this computer");
  const ready = voice.state.engines.filter((e) => e.model.status === "ready");
  if (!voice.engine || !ready.length) return dim("not set up");
  const engine =
    ready.find((e) => e.id === voice.state.settings.engine) ?? ready[0]!;
  const picked = voice.state.settings.voices[engine.id];
  const name = (engine.voices.find((v) => v.id === picked) ?? engine.voices[0])
    ?.name;
  return `${engine.name}${name ? `, ${name}` : ""}, ${voice.state.settings.speed}×`;
}

interface Row {
  key: string;
  section: "General" | "Agents" | "Phones";
  label: string;
  value(s: Snapshot): string;
}

const rows: Row[] = [
  { key: "name", section: "General", label: "Name", value: (s) => s.name },
  {
    key: "port",
    section: "General",
    label: "Port",
    value: (s) => String(s.port),
  },
  {
    key: "auto-update",
    section: "General",
    label: "Install updates automatically",
    value: (s) =>
      s.update.status === "off"
        ? dim("not for a build from source; git pull updates it")
        : `${s.autoUpdate ? "on" : "off"}${s.update.status === "available" ? yellow(`  (${s.update.version} is out)`) : ""}`,
  },
  {
    key: "keep-awake",
    section: "General",
    label: "Keep the computer awake",
    value: (s) => (s.keepAwake ? "on" : "off"),
  },
  {
    key: "auto-settle",
    section: "General",
    label: "Settle quiet threads",
    value: (s) => days(s.autoSettleDays),
  },
  {
    key: "worktree-cleanup",
    section: "General",
    label: "Remove settled threads' worktrees",
    value: (s) => days(s.worktreeCleanupDays),
  },
  {
    key: "new-thread-agent",
    section: "Agents",
    label: "New threads start with",
    value: (s) =>
      s.newThreadAgent
        ? agentInfo(s.newThreadAgent).name
        : dim("the last one used"),
  },
  ...(["claude", "codex", "opencode", "amp"] as const).map((provider): Row => ({
    key: provider,
    section: "Agents",
    label: agentInfo(provider).cli,
    value: (s) => agentValue(s.agents.find((a) => a.provider === provider)),
  })),
  {
    key: "cursor",
    section: "Agents",
    label: "Cursor",
    value: (s) => cursorValue(s.agents.find((a) => a.provider === "cursor")),
  },
  {
    key: "watch-threads",
    section: "Agents",
    label: "Flag what I'd miss (Claude)",
    value: (s) => watchLabels[s.watchThreads],
  },
  {
    key: "git",
    section: "Agents",
    label: "Git",
    value: (s) =>
      s.git.path
        ? `${s.git.version ?? ""}  ${dim(s.git.path + (s.git.chosen ? " (set here)" : ""))}`
        : yellow(s.git.error ?? "not found"),
  },
  {
    key: "gitea",
    section: "Agents",
    label: "Gitea",
    value: (s) =>
      s.gitea
        ? `${s.gitea.user.login} on ${s.gitea.server}`
        : dim("not signed in"),
  },
  {
    key: "dictation",
    section: "Phones",
    label: "Dictation",
    value: (s) => dictationValue(s.speech),
  },
  {
    key: "read-aloud",
    section: "Phones",
    label: "Read aloud",
    value: (s) => voiceValue(s.speech),
  },
];

function print(s: Snapshot, numbered: boolean) {
  const width = Math.max(...rows.map((r) => r.label.length));
  let section = "";
  rows.forEach((row, i) => {
    if (row.section !== section) {
      section = row.section;
      console.log(`\n${bold(section)}`);
    }
    const n = numbered ? `${String(i + 1).padStart(3)}  ` : "  ";
    console.log(`${n}${row.label.padEnd(width)}  ${row.value(s)}`);
  });
}

// ── Asking ─────────────────────────────────────────────────────────────

/** Prompts on the terminal; scripts give values on the command line instead. */
class Ask {
  constructor(private rl: Interface) {}
  async text(question: string) {
    return (await this.rl.question(`${question} `)).trim();
  }
  async yes(question: string, fallback: boolean) {
    const answer = (
      await this.rl.question(
        `${question} ${dim(fallback ? "[Y/n]" : "[y/N]")} `,
      )
    )
      .trim()
      .toLowerCase();
    return answer ? answer.startsWith("y") : fallback;
  }
  /** One of `options`, by number; undefined when left empty. */
  async pick<T>(question: string, options: { value: T; label: string }[]) {
    options.forEach((o, i) =>
      console.log(`  ${String(i + 1).padStart(2)}  ${o.label}`),
    );
    const answer = await this.text(
      `${question} ${dim("(number, empty to keep)")}`,
    );
    if (!answer) return undefined;
    const picked = options[Number(answer) - 1];
    if (!picked)
      throw new Error(`Choose a number from 1 to ${options.length}.`);
    return picked.value;
  }
  /** Typed without showing it, for tokens. */
  async secret(question: string) {
    process.stdout.write(`${question} `);
    const rl = this.rl as unknown as {
      _writeToOutput?: (text: string) => void;
    };
    const shown = rl._writeToOutput;
    rl._writeToOutput = () => {};
    try {
      return (await this.rl.question("")).trim();
    } finally {
      rl._writeToOutput = shown;
      process.stdout.write("\n");
    }
  }
}

// ── Changing ───────────────────────────────────────────────────────────

const parseDays = (value: string, min: number) => {
  if (/^(never|off)$/i.test(value)) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > 90)
    throw new Error(`Give a number of days from ${min} to 90, or "never".`);
  return n;
};
const parseOn = (value: string) => {
  if (/^(on|yes|true|1)$/i.test(value)) return true;
  if (/^(off|no|false|0)$/i.test(value)) return false;
  throw new Error('Say "on" or "off".');
};

/** Sets `key` to `value` as typed; what needs a restart says so. */
export async function setValue(
  ctx: SettingsContext,
  key: string,
  value: string,
) {
  switch (key) {
    case "name": {
      const name = value.trim();
      if (!name || name.length > 80)
        throw new Error("Give a name of up to 80 characters.");
      await saveConfig(ctx.home, { name });
      return "restart";
    }
    case "port": {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("Give a port from 1 to 65535.");
      await saveConfig(ctx.home, { port });
      return "restart";
    }
    case "auto-update":
      await saveConfig(ctx.home, { autoUpdate: parseOn(value) });
      return;
    case "keep-awake":
      await call(ctx, "saveKeepAwake", parseOn(value));
      return;
    case "auto-settle":
      await call(ctx, "saveAutoSettleDays", parseDays(value, 1));
      return;
    case "worktree-cleanup":
      await call(ctx, "saveWorktreeCleanupDays", parseDays(value, 0));
      return;
    case "new-thread-agent": {
      const provider = runnableAgents().find(
        (p) =>
          p === value.toLowerCase() ||
          agentInfo(p).name.toLowerCase() === value.toLowerCase(),
      );
      if (!provider)
        throw new Error(`Choose one of ${runnableAgents().join(", ")}.`);
      await call(ctx, "saveNewThreadAgent", provider);
      return;
    }
    case "watch-threads": {
      if (!(watchScopes as readonly string[]).includes(value))
        throw new Error(`Choose one of ${watchScopes.join(", ")}.`);
      await call(ctx, "saveWatchThreads", value);
      return;
    }
    case "claude":
    case "codex":
    case "opencode":
    case "amp":
      if (!value || value === "auto") await call(ctx, "unlinkAgent", key);
      else await call(ctx, "linkAgent", key, value);
      return;
    case "git":
      if (!value || value === "auto") await call(ctx, "resetGit");
      else await call(ctx, "chooseGit", value);
      return;
    default:
      throw new Error(
        `There's no setting “${key}”. Settings: ${rows
          .filter(
            (r) =>
              !["cursor", "gitea", "dictation", "read-aloud"].includes(r.key),
          )
          .map((r) => r.key)
          .join(", ")}.`,
      );
  }
}

/** Follows a speech setup to its end: a line that redraws on a terminal, a line per tenth in a log. */
async function follow(ctx: SettingsContext, engine: SpeechEngine) {
  const leave = () => {
    console.log(
      "\nIt carries on in the background; relay settings shows how far it got.",
    );
    process.exit(130);
  };
  process.once("SIGINT", leave);
  try {
    let logged = "";
    for (;;) {
      const state = await callControl(control(ctx), "speech");
      const setup = state.setup;
      if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
      if (!setup || setup.engine !== engine) return;
      if (setup.status === "failed")
        throw new Error(setup.error ?? "Setting it up failed.");
      if (setup.status === "done") return console.log(ok("Ready."));
      const what =
        setup.step === "engine"
          ? `the ${engine === "dictation" ? "speech" : "voice"} engine`
          : engine === "dictation"
            ? "the model"
            : "the voice";
      const model =
        engine === "dictation"
          ? state.dictation.model
          : state.voice.state.engines.find(
              (e) => e.model.status === "downloading",
            )?.model;
      const progress =
        setup.step === "engine"
          ? state.download
          : model?.status === "downloading"
            ? model
            : undefined;
      const line = `Downloading ${what}…${progress ? ` ${megabytes(progress.received)}${progress.total ? ` of ${megabytes(progress.total)}` : ""}` : ""}`;
      if (process.stdout.isTTY) process.stdout.write(line);
      else {
        const tenth = progress?.total
          ? Math.floor((progress.received / progress.total) * 10)
          : "";
        if (`${what} ${tenth}` !== logged) console.log(line);
        logged = `${what} ${tenth}`;
      }
      await sleep(process.stdout.isTTY ? 400 : 2000);
    }
  } finally {
    process.off("SIGINT", leave);
  }
}

export async function setUpDictation(ctx: SettingsContext) {
  await callControl(control(ctx), "installSpeech", "dictation");
  await follow(ctx, "dictation");
  console.log("Phones dictate with this computer's speech engine now.");
}

export async function setUpVoice(ctx: SettingsContext, engine?: string) {
  await callControl(control(ctx), "installSpeech", "voice", engine);
  await follow(ctx, "voice");
  console.log(
    "Phones can have answers read aloud in this computer's voice now.",
  );
}

export async function signInCursor(ctx: SettingsContext) {
  console.log(dim("Getting Cursor's sign-in page (the SDK downloads first)…"));
  const login = await callControl(control(ctx), "cursorSignIn");
  if (login.status === "done") return console.log(ok("Signed in to Cursor."));
  if (!login.url)
    throw new Error(login.error ?? "Cursor didn't give a sign-in page.");
  console.log(
    `\nOpen this on your phone or another computer to sign in to Cursor:\n`,
  );
  console.log(terminalQr(login.url, { color: colorful }));
  console.log(`\n  ${cyan(login.url)}\n`);
  console.log(dim("Waiting for the sign-in… (Ctrl-C to stop waiting)"));
  for (const until = Date.now() + 5 * 60_000; Date.now() < until;) {
    await sleep(2000);
    const now = await callControl(control(ctx), "cursorSignInState");
    if (now?.status === "done") return console.log(ok("Signed in to Cursor."));
    if (now?.status === "failed")
      throw new Error(now.error ?? "Cursor's sign-in failed.");
  }
  throw new Error("Cursor's sign-in wasn't finished within five minutes.");
}

export async function signInGitea(
  ctx: SettingsContext,
  server: string,
  token: string,
) {
  const account = await call<Account>(ctx, "connect", server, token);
  console.log(ok(`Signed in to ${account.server} as ${account.user.login}.`));
}

/** A secret from stdin when it's piped, so it stays out of the shell's history. */
async function piped() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text.trim();
}

// ── The command ────────────────────────────────────────────────────────

export async function settingsCommand(ctx: SettingsContext, words: string[]) {
  const [action, ...args] = words;
  if (!action) {
    if (!ctx.json && process.stdin.isTTY && process.stdout.isTTY)
      return menu(ctx);
    return list(ctx);
  }
  switch (action) {
    case "list":
      return list(ctx);
    case "set": {
      const [key, ...value] = args;
      if (!key) throw new Error("relay settings set <key> <value>");
      const after = await setValue(ctx, key, value.join(" "));
      console.log(ok(`Saved ${key}.`));
      if (after === "restart")
        console.log(
          `It's used from the next start; ${bold("relay restart")} does that now.`,
        );
      return;
    }
    case "dictation":
      if (args[0] === "remove") {
        await callControl(control(ctx), "removeSpeech", "dictation");
        return console.log(ok("Dictation is removed from this computer."));
      }
      if (args[0] && args[0] !== "install")
        throw new Error("relay settings dictation [install|remove]");
      return setUpDictation(ctx);
    case "read-aloud":
    case "voice": {
      const [verb, engine, voice] = args;
      if (verb === "remove") {
        await callControl(control(ctx), "removeSpeech", "voice", engine);
        return console.log(
          ok(
            engine
              ? `Removed ${engine}.`
              : "Read aloud is removed from this computer.",
          ),
        );
      }
      if (verb === "use") {
        if (!engine)
          throw new Error("relay settings read-aloud use <engine> [voice]");
        const state = (await callControl(control(ctx), "speech")).voice.state;
        await call(ctx, "saveReadAloudSettings", {
          ...state.settings,
          engine,
          voices: {
            ...state.settings.voices,
            ...(voice ? { [engine]: voice } : {}),
          },
        });
        return console.log(ok("Saved."));
      }
      if (verb === "speed") {
        const speed = Number(engine);
        if (!readAloudSpeeds.includes(speed))
          throw new Error(`Choose a speed of ${readAloudSpeeds.join(", ")}.`);
        const state = (await callControl(control(ctx), "speech")).voice.state;
        await call(ctx, "saveReadAloudSettings", { ...state.settings, speed });
        return console.log(ok("Saved."));
      }
      if (verb && verb !== "install")
        throw new Error(
          "relay settings read-aloud [install [engine]|use <engine> [voice]|speed <x>|remove [engine]]",
        );
      return setUpVoice(ctx, engine);
    }
    case "cursor":
      if (args[0] === "sign-out") {
        await callControl(control(ctx), "cursorSignOut");
        return console.log(ok("Signed out of Cursor."));
      }
      return signInCursor(ctx);
    case "gitea": {
      if (args[0] === "sign-out") {
        await call(ctx, "disconnect");
        return console.log(ok("Signed out of Gitea."));
      }
      const server = args[0] === "sign-in" ? args[1] : args[0];
      if (!server)
        throw new Error(
          "relay settings gitea sign-in <server>, with the token on stdin",
        );
      const token = process.stdin.isTTY
        ? await withAsk((ask) => ask.secret("Access token:"))
        : await piped();
      if (!token) throw new Error("Give an access token.");
      return signInGitea(ctx, server, token);
    }
    default:
      throw new Error(
        `Unknown: relay settings ${action}. Try list, set, dictation, read-aloud, cursor or gitea.`,
      );
  }
}

async function withAsk<T>(work: (ask: Ask) => Promise<T>) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    rl.close();
    process.stdout.write("\n");
    process.exit(130);
  });
  try {
    return await work(new Ask(rl));
  } finally {
    rl.close();
  }
}

async function list(ctx: SettingsContext) {
  const s = await snapshot(ctx);
  if (ctx.json) return console.log(JSON.stringify(s, null, 2));
  print(s, false);
  console.log(
    `\n${dim("Change one with relay settings set <key> <value>, or run relay settings in a terminal for a menu.")}`,
  );
}

async function menu(ctx: SettingsContext) {
  await withAsk(async (ask) => {
    let restart = false;
    for (;;) {
      const s = await snapshot(ctx);
      console.log(`\n${bold("Relay settings")} ${dim(`(${ctx.home})`)}`);
      print(s, true);
      const answer = await ask.text(
        `\n${restart ? yellow("Restart to use the new name or port. ") : ""}Number to change, ${restart ? "r to restart, " : ""}q to quit:`,
      );
      if (!answer || /^q/i.test(answer)) break;
      if (restart && /^r/i.test(answer)) {
        await ctx.restart();
        restart = false;
        continue;
      }
      const row = rows[Number(answer) - 1];
      if (!row) {
        console.log(warn(`Choose a number from 1 to ${rows.length}.`));
        continue;
      }
      try {
        if ((await change(ctx, ask, row, s)) === "restart") restart = true;
      } catch (e) {
        console.log(warn(e instanceof Error ? e.message : String(e)));
      }
    }
    if (
      restart &&
      (await ask.yes("Restart Relay now to use the new name or port?", true))
    )
      await ctx.restart();
  });
}

/** Asks for one setting's new value in the menu. */
async function change(ctx: SettingsContext, ask: Ask, row: Row, s: Snapshot) {
  switch (row.key) {
    case "name": {
      const name = await ask.text(`Name ${dim(`(now ${s.name})`)}:`);
      return name ? setValue(ctx, "name", name) : undefined;
    }
    case "port": {
      const port = await ask.text(`Port ${dim(`(now ${s.port})`)}:`);
      return port ? setValue(ctx, "port", port) : undefined;
    }
    case "auto-update":
      if (s.update.status === "off")
        throw new Error(
          "A build from source updates with git pull and npm run build:headless.",
        );
      return setValue(
        ctx,
        "auto-update",
        (await ask.yes(
          "Install new releases by themselves, once no thread is working?",
          s.autoUpdate,
        ))
          ? "on"
          : "off",
      );
    case "keep-awake":
      return setValue(
        ctx,
        "keep-awake",
        (await ask.yes(
          "Keep the computer from idling to sleep while Relay runs?",
          s.keepAwake,
        ))
          ? "on"
          : "off",
      );
    case "auto-settle":
    case "worktree-cleanup": {
      const value = await ask.text(
        `${row.label}: days ${row.key === "auto-settle" ? "(1–90)" : "(0–90)"} or "never" ${dim(`(now ${row.value(s)})`)}:`,
      );
      return value ? setValue(ctx, row.key, value) : undefined;
    }
    case "new-thread-agent": {
      const provider = await ask.pick(
        "New threads start with",
        runnableAgents().map((p) => ({ value: p, label: agentInfo(p).name })),
      );
      return provider ? setValue(ctx, row.key, provider) : undefined;
    }
    case "watch-threads": {
      const scope = await ask.pick(
        "Flag what I'd miss in Claude threads",
        watchScopes.map((w) => ({ value: w, label: watchLabels[w] })),
      );
      return scope ? setValue(ctx, row.key, scope) : undefined;
    }
    case "claude":
    case "codex":
    case "opencode":
    case "amp":
    case "git": {
      const path = await ask.text(
        `Path to ${row.key === "git" ? "git" : cliName(row.key)} ${dim('(empty keeps it, "auto" finds it again)')}:`,
      );
      return path ? setValue(ctx, row.key, path) : undefined;
    }
    case "cursor": {
      const cursor = s.agents.find((a) => a.provider === "cursor");
      if (cursor?.account?.signedIn) {
        if (await ask.yes("Sign out of Cursor?", false)) {
          await callControl(control(ctx), "cursorSignOut");
          console.log(ok("Signed out of Cursor."));
        }
        return;
      }
      return signInCursor(ctx);
    }
    case "gitea": {
      if (s.gitea) {
        if (await ask.yes(`Sign out of ${s.gitea.server}?`, false)) {
          await call(ctx, "disconnect");
          console.log(ok("Signed out of Gitea."));
        }
        return;
      }
      const server = await ask.text(
        "Gitea server, e.g. https://git.example.com:",
      );
      if (!server) return;
      const token = await ask.secret(
        `Access token ${dim("(Gitea: Settings → Applications → Generate new token)")}:`,
      );
      if (token) await signInGitea(ctx, server, token);
      return;
    }
    case "dictation": {
      const { dictation } = s.speech;
      if (!dictation.supported)
        throw new Error("Dictation isn't available on this computer.");
      if (dictation.engine && dictation.model.status === "ready") {
        if (await ask.yes("Remove dictation from this computer?", false)) {
          await callControl(control(ctx), "removeSpeech", "dictation");
          console.log(ok("Removed."));
        }
        return;
      }
      if (
        await ask.yes(
          `Set up dictation for phones? It downloads the speech engine and a ${megabytes(dictationModelSize)} model.`,
          true,
        )
      )
        await setUpDictation(ctx);
      return;
    }
    case "read-aloud":
      return changeVoice(ctx, ask, s);
  }
}

async function changeVoice(ctx: SettingsContext, ask: Ask, s: Snapshot) {
  const { voice } = s.speech;
  if (!voice.supported)
    throw new Error("Read aloud isn't available on this computer.");
  const engines = voice.state.engines;
  const ready = voice.engine
    ? engines.filter((e) => e.model.status === "ready")
    : [];
  if (!ready.length) {
    const engine = await ask.pick(
      "Download which voice?",
      engines.map((e) => ({
        value: e.id,
        label: `${e.name} ${dim(`${megabytes(e.size)}, ${e.credit}`)}`,
      })),
    );
    if (engine) await setUpVoice(ctx, engine);
    return;
  }
  const action = await ask.pick("Read aloud", [
    { value: "voice", label: "Choose the voice" },
    { value: "speed", label: "Choose the speed" },
    { value: "add", label: "Download another engine" },
    { value: "remove", label: "Remove read aloud" },
  ]);
  const settings = voice.state.settings;
  if (action === "voice") {
    const choice = await ask.pick(
      "Voice",
      ready.flatMap((e) =>
        e.voices.map((v) => ({
          value: [e.id, v.id] as const,
          label: `${v.name} ${dim(`${v.language}, ${e.name}`)}`,
        })),
      ),
    );
    if (choice)
      await call(ctx, "saveReadAloudSettings", {
        ...settings,
        engine: choice[0],
        voices: { ...settings.voices, [choice[0]]: choice[1] },
      });
  } else if (action === "speed") {
    const speed = await ask.pick(
      "Speed",
      readAloudSpeeds.map((x) => ({ value: x, label: `${x}×` })),
    );
    if (speed) await call(ctx, "saveReadAloudSettings", { ...settings, speed });
  } else if (action === "add") {
    const engine = await ask.pick(
      "Download which voice?",
      engines
        .filter((e) => e.model.status !== "ready")
        .map((e) => ({
          value: e.id,
          label: `${e.name} ${dim(megabytes(e.size))}`,
        })),
    );
    if (engine) await setUpVoice(ctx, engine);
  } else if (
    action === "remove" &&
    (await ask.yes("Remove every voice and the engine?", false))
  ) {
    await callControl(control(ctx), "removeSpeech", "voice");
    console.log(ok("Removed."));
  }
}
