// `relay settings`: what the desktop's Settings sets up, for a Relay with
// no window. In a terminal it's a menu; `relay settings set <key> <value>`
// and the subcommands do the same from a script. Everything changes in the
// running Relay through the desktop's own calls and their validation.
import { runnableAgents, agentInfo } from "../../../shared/agents";
import { dictationModelSize } from "../../../shared/dictation";
import { readAloudSpeeds } from "../../../shared/read-aloud";
import type { Account } from "../../../shared/types";
import { watchScopes } from "../../../shared/watch";
import { callControl } from "../control";
import { bold, colorful, cyan, dim, ok, warn, yellow } from "../format";
import { saveConfig } from "../launch";
import { terminalQr } from "../qr";
import { errorMessage } from "../../../shared/error-message";
import { sleep } from "../../util/sleep";
import { Ask, piped, withAsk } from "./ask";
import {
  call,
  control,
  snapshot,
  type SettingsContext,
  type Snapshot,
} from "./snapshot";
import { cliName, print, rows, watchLabels, type Row } from "./rows";
import { changeVoice, megabytes, setUpDictation, setUpVoice } from "./speech";

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
    case "usage-ping":
      await call(ctx, "saveUsagePing", parseOn(value));
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
    case "muse":
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
        console.log(warn(errorMessage(e)));
      }
    }
    if (
      restart &&
      (await ask.yes("Restart Relay now to use the new name or port?", true))
    )
      await ctx.restart();
  });
}

/** Settings the menu turns on or off with one question. */
const switches: Partial<
  Record<string, { question: string; on(s: Snapshot): boolean }>
> = {
  "keep-awake": {
    question: "Keep the computer from idling to sleep while Relay runs?",
    on: (s) => s.keepAwake,
  },
  "usage-ping": {
    question:
      "Tell relaycode.io once a day that Relay is in use (version and system, no ID)?",
    on: (s) => s.usagePing,
  },
};

/** Asks for one setting's new value in the menu. */
async function change(ctx: SettingsContext, ask: Ask, row: Row, s: Snapshot) {
  const toggle = switches[row.key];
  if (toggle) {
    const on = await ask.yes(toggle.question, toggle.on(s));
    return setValue(ctx, row.key, on ? "on" : "off");
  }
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
    case "muse":
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
