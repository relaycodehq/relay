// Why Claude Code signs out is hidden from Relay: the CLI refreshes its token
// in its own process. What `main.log` can show is the file the CLI keeps its
// sign-in in (Windows and Linux; macOS uses the Keychain), which of Relay's
// Claude processes were running when that file changed, what probes said
// about OAuth in debug mode, and when the CLI started reporting no sign-in.
// Never a token: the refresh token shows as a short hash, enough to see it
// rotate.
import { createHash, randomUUID } from "node:crypto";
import { watchFile } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM_ACCOUNT } from "../../../shared/agent-accounts";
import { accountHomes } from "../accounts";

interface Run {
  kind: string;
  account: string;
  started: number;
  ended?: number;
}
const running = new Set<Run>();
/** Probes closed lately: one still saving a refresh has left `running` by the time the file changes. */
let ended: Run[] = [];
const RECENT = 2 * 60_000;

let sessionAccounts: () => string[] = () => [];
/** How the trace counts the threads' Claude sessions, each by its account. */
export function traceSessions(accounts: () => string[]) {
  sessionAccounts = accounts;
}

/** Past the SDK's grace before it kills a closed CLI, which may still be saving a refresh. */
const SETTLE = 10_000;
/**
 * Marks a probe as running and gives it a debug log to write. Once it has
 * closed, what it said about its sign-in goes to `main.log` and the log is
 * deleted.
 */
export function traceProbe(kind: string, account = SYSTEM_ACCOUNT) {
  const run: Run = { kind, account, started: Date.now() };
  running.add(run);
  const debugFile = join(tmpdir(), `relay-claude-${kind}-${randomUUID()}.log`);
  return {
    debugFile,
    closed() {
      running.delete(run);
      run.ended = Date.now();
      ended = [...ended.filter((r) => run.ended! - r.ended! < RECENT), run];
      setTimeout(() => void report(), SETTLE).unref();
    },
  };
  async function report() {
    const said = await readFile(debugFile, "utf8").catch(() => "");
    await rm(debugFile, { force: true }).catch(() => {});
    const lines = authLines(said);
    if (lines.length)
      console.info(
        `[claude-auth] ${kind} probe (${account}) said:\n  ${lines.join("\n  ")}`,
      );
  }
}

const AUTH =
  /oauth|refresh lock|token refresh|invalid_grant|\/login|credentials|keychain|not logged in|\b401\b|\bauth:/i;
/** The debug lines about the CLI's own sign-in, tokens blanked out. */
export function authLines(log: string) {
  return log
    .split("\n")
    .filter((line) => AUTH.test(line) && !/\bmcp\b/i.test(line))
    .map((line) =>
      line
        .replace(/sk-ant-[\w-]+/g, "[token]")
        .replace(/[\w.+/=-]{40,}/g, "[…]")
        .slice(0, 300),
    )
    .slice(-20);
}

/** What the sign-in file holds, as far as a log may say. */
export interface SavedSignIn {
  state: "missing" | "unreadable" | "saved";
  bytes?: number;
  access?: boolean;
  /** A hash of the refresh token, to see it rotate. */
  refresh?: string;
  expiresAt?: number;
}

export async function readSavedSignIn(home: string): Promise<SavedSignIn> {
  let text: string;
  try {
    text = await readFile(join(home, ".credentials.json"), "utf8");
  } catch {
    return { state: "missing" };
  }
  try {
    const oauth = JSON.parse(text)?.claudeAiOauth ?? {};
    const refresh =
      typeof oauth.refreshToken === "string" && oauth.refreshToken
        ? createHash("sha256")
            .update(oauth.refreshToken)
            .digest("hex")
            .slice(0, 8)
        : undefined;
    return {
      state: "saved",
      bytes: text.length,
      access: typeof oauth.accessToken === "string" && !!oauth.accessToken,
      refresh,
      expiresAt:
        typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
    };
  } catch {
    // Half-written, or emptied by a process that lost a refresh.
    return { state: "unreadable", bytes: text.length };
  }
}

export function describeSaved(saved: SavedSignIn, now = Date.now()) {
  if (saved.state === "missing") return "no sign-in file";
  if (saved.state === "unreadable") return `unreadable (${saved.bytes} bytes)`;
  const parts = [
    saved.access ? "access token" : "NO access token",
    saved.refresh ? `refresh ${saved.refresh}` : "NO refresh token",
  ];
  if (saved.expiresAt) {
    const minutes = Math.round((saved.expiresAt - now) / 60_000);
    parts.push(
      `expires ${new Date(saved.expiresAt).toISOString()} (${
        minutes >= 0 ? `in ${minutes}min` : `${-minutes}min ago`
      })`,
    );
  }
  return parts.join(", ");
}

const usable = (saved: SavedSignIn) =>
  saved.state === "saved" && !!saved.access && !!saved.refresh;

/** Relay's Claude processes right now, and the probes closed lately. */
export function describeRunning(now = Date.now()) {
  const parts = [...running].map(
    (r) => `${r.kind} probe (${r.account}) running ${now - r.started}ms`,
  );
  for (const r of ended)
    if (now - r.ended! < RECENT)
      parts.push(
        `${r.kind} probe (${r.account}) closed ${now - r.ended!}ms ago after ${r.ended! - r.started}ms`,
      );
  const sessions = sessionAccounts();
  if (sessions.length)
    parts.push(
      `${sessions.length} sessions (${[...new Set(sessions)].join(", ")})`,
    );
  return parts.length ? parts.join("; ") : "none";
}

const watched = new Map<string, string>();
/**
 * Logs each Claude account's sign-in file once, and every time it changes.
 * Polled, so a file replaced or deleted is still seen. Run again as accounts
 * are added; a file already watched is left alone.
 */
export function watchSavedSignIns() {
  if (process.platform === "darwin") return;
  for (const { provider, account, home } of accountHomes()) {
    if (provider !== "claude") continue;
    const path = join(home, ".credentials.json");
    if (watched.has(path)) continue;
    watched.set(path, account);
    let last: SavedSignIn | undefined;
    const look = async () => {
      const saved = await readSavedSignIn(home);
      const now = Date.now();
      if (!last)
        console.info(`[claude-auth] ${account}: ${describeSaved(saved, now)}`);
      else
        (usable(saved) ? console.info : console.warn)(
          `[claude-auth] ${account}: sign-in file changed from ${describeSaved(last, now)} to ${describeSaved(saved, now)}; Relay's Claude processes: ${describeRunning(now)}`,
        );
      last = saved;
    };
    void look();
    watchFile(path, { interval: 5000, persistent: false }, () => void look());
  }
}

const signedOut = new Set<string>();
/**
 * Notes what the CLI said about the account's sign-in. Logged only when it
 * turns: the first "signed out", and getting back in.
 */
export function noteClaudeSignIn(
  account: string,
  signedIn: boolean,
  asked: string,
  home?: string,
) {
  if (signedIn === !signedOut.has(account)) return;
  if (signedIn) {
    signedOut.delete(account);
    console.info(
      `[claude-auth] ${account}: Claude is signed in again (${asked})`,
    );
    return;
  }
  signedOut.add(account);
  const detail =
    home && process.platform !== "darwin"
      ? readSavedSignIn(home).then((saved) => describeSaved(saved))
      : Promise.resolve(process.platform === "darwin" ? "in the Keychain" : "");
  void detail.then((file) =>
    console.warn(
      `[claude-auth] ${account}: Claude reports no sign-in (${asked})${file ? `; sign-in file: ${file}` : ""}; Relay's Claude processes: ${describeRunning()}`,
    ),
  );
}
