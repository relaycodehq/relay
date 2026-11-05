// Session and weekly limits for the signed-in accounts. Claude Code reports its
// own through the Agent SDK. For Codex, Relay reads the CLI's sign-in and asks
// ChatGPT; tokens stay in the main process and rotated ones are written back to
// the same credential store.
import { homedir } from "node:os";
import { join } from "node:path";
import {
  mapClaudeUsage,
  mapCodexCredits,
  mapCodexResets,
  mapCodexUsage,
  providerUsageSchema,
  type ProviderUsage,
  type SavedResets,
  type UsageCredits,
  type UsageWindow,
} from "../../shared/provider-usage";
import { readClaudeUsage } from "./claude/project";
import { readAntigravityUsage } from "./antigravity";
import { readMuseUsage } from "./muse";
import type { UsageProvider } from "../../shared/agents";
import { SYSTEM_ACCOUNT } from "../../shared/agent-accounts";
import { recordUsage } from "./usage-history";
import { profileDir } from "./accounts/profiles";
import { withTimeout } from "../util/timeout";
import { asRecord } from "../../shared/records";
import {
  allowKeychainWrites,
  codexKeychainAccount,
  readKeychain,
} from "./keychain";
import {
  codexCredential,
  jwtNumber,
  parseJson,
  readText,
  stringField,
  type Credential,
} from "./codex/codex-sign-in";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const SUCCESS_TTL = 45_000;
const EMPTY_TTL = 8_000;
// Without a running session, each Claude reading starts the CLI.
const CLAUDE_TTL = 150_000;
const REFRESH_SLACK = 5 * 60 * 1000;
// Claude starts its CLI for a reading, so this leaves it room.
const LOAD_TIMEOUT = 60_000;

/** By `provider:account`. */
const cache = new Map<string, { at: number; value: ProviderUsage }>();
const pending = new Map<string, Promise<ProviderUsage>>();

/** How to read each agent's usage, and how long a reading holds. */
const readers: Record<
  UsageProvider,
  { load: (account: string) => Promise<ProviderUsage>; ttl?: number }
> = {
  claude: { load: loadClaude, ttl: CLAUDE_TTL },
  codex: { load: loadCodex },
  antigravity: { load: readAntigravityUsage },
  // Only one Muse sign-in: its accounts aren't Relay's to switch.
  muse: { load: () => readMuseUsage() },
};

/** The limits of one of the agent's accounts; its usual sign-in when left out. */
export function readProviderUsage(
  provider: UsageProvider,
  force = false,
  account = SYSTEM_ACCOUNT,
): Promise<ProviderUsage> {
  const key = `${provider}:${account}`;
  const hit = cache.get(key);
  const ttl =
    readers[provider].ttl ??
    (hit?.value.windows.length ? SUCCESS_TTL : EMPTY_TTL);
  if (!force && hit && Date.now() - hit.at < ttl) {
    return Promise.resolve(hit.value);
  }
  const existing = pending.get(key);
  if (existing) return existing;
  // Later readings join this one, so one that never settles would freeze the ring.
  const task = withTimeout(
    readers[provider].load(account),
    LOAD_TIMEOUT,
    `${provider} usage took too long`,
  )
    .catch((): ProviderUsage => ({
      provider,
      windows: [],
      message: "Couldn't read usage",
    }))
    .then(async (value) => {
      const activeHours = await recordUsage(
        value,
        account === SYSTEM_ACCOUNT ? provider : key,
      ).catch(() => null);
      const parsed = providerUsageSchema.parse({ ...value, activeHours });
      cache.set(key, { at: Date.now(), value: parsed });
      return parsed;
    })
    .finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

async function loadClaude(account: string): Promise<ProviderUsage> {
  const usage = await readClaudeUsage(account);
  if (!usage) {
    return { provider: "claude", windows: [], message: "Sign in with claude" };
  }
  const windows = mapClaudeUsage(usage.rate_limits);
  return {
    provider: "claude",
    windows,
    message: windows.length ? null : "No usage limits reported",
  };
}

async function loadCodex(account: string): Promise<ProviderUsage> {
  const system = account === SYSTEM_ACCOUNT;
  // Another account's sign-in is only ever in its own folder.
  const paths = system
    ? codexAuthPaths()
    : [join(profileDir("codex", account), "auth.json")];
  const files = (
    await Promise.all(paths.map((path) => readCodexFile(path)))
  ).filter((item): item is Credential => item != null);
  const keychain = system ? await readCodexKeychain() : null;
  const credentials = dedupe(
    [...files, keychain].filter((item): item is Credential => item != null),
  );
  if (!credentials.length) {
    const apiKey = await codexHasApiKeyOnly(paths);
    return {
      provider: "codex",
      windows: [],
      message: apiKey
        ? "Codex usage needs a ChatGPT sign-in"
        : "Sign in with codex",
    };
  }
  return probe(credentials, async (token, accountId) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "Relay",
    };
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;
    const response = await request(
      "https://chatgpt.com/backend-api/wham/usage",
      headers,
    );
    const body = await jsonBody(response);
    const counted = response.ok ? mapCodexResets(body) : null;
    return {
      response,
      windows: mapCodexUsage(body, Date.now(), {
        primary: headerNumber(response, "x-codex-primary-used-percent"),
        secondary: headerNumber(response, "x-codex-secondary-used-percent"),
      }),
      credits: mapCodexCredits(body),
      resets: counted && mapCodexResets(body, await listResets(headers)),
    };
  });
}

/**
 * Codex's list of saved resets, with when each lapses. Only asked for when
 * the usage reading counts some; without it the count still shows.
 */
async function listResets(headers: Record<string, string>) {
  try {
    const response = await request(
      "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
      headers,
    );
    return response.ok ? await jsonBody(response) : undefined;
  } catch {
    return undefined;
  }
}

async function probe(
  credentials: Credential[],
  fetchUsage: (
    token: string,
    accountId: string | null,
  ) => Promise<{
    response: Response;
    windows: UsageWindow[];
    credits: UsageCredits | null;
    resets: SavedResets | null;
  }>,
): Promise<ProviderUsage> {
  let message = "Sign in with codex";
  for (const cred of credentials) {
    try {
      if (needsRefresh(cred, Date.now())) await refreshCodex(cred, false);
      let result = await fetchUsage(cred.accessToken, cred.accountId);
      if (
        (result.response.status === 401 || result.response.status === 403) &&
        cred.refreshToken
      ) {
        await refreshCodex(cred, true);
        result = await fetchUsage(cred.accessToken, cred.accountId);
      }
      if (result.response.status === 429) {
        return {
          provider: "codex",
          windows: [],
          message: "Usage is rate limited",
        };
      }
      if (result.response.status === 401 || result.response.status === 403) {
        message = "Sign in with codex again";
        continue;
      }
      if (!result.response.ok) {
        message = "Couldn't read usage";
        continue;
      }
      return {
        provider: "codex",
        windows: result.windows,
        message: result.windows.length ? null : "No usage limits reported",
        credits: result.credits,
        resets: result.resets,
      };
    } catch {
      message = "Couldn't reach the usage service";
    }
  }
  return { provider: "codex", windows: [], message };
}

function needsRefresh(cred: Credential, now: number) {
  const exp = jwtNumber(cred.accessToken, "exp");
  if (exp != null) return exp * 1000 - now <= REFRESH_SLACK;
  if (!cred.lastRefresh) return false;
  const at = Date.parse(cred.lastRefresh);
  return Number.isFinite(at) && now - at > 8 * 24 * 60 * 60 * 1000;
}

async function refreshCodex(cred: Credential, force: boolean) {
  await cred.reload();
  if (!force && !needsRefresh(cred, Date.now())) return;
  if (!cred.refreshToken) return;
  const response = await request(
    "https://auth.openai.com/oauth/token",
    {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CODEX_CLIENT_ID,
      refresh_token: cred.refreshToken,
    }).toString(),
  );
  if (!response.ok) throw new Error("codex refresh rejected");
  const body = asRecord(await jsonBody(response));
  const accessToken = stringField(body, "access_token");
  if (!accessToken) throw new Error("codex refresh rejected");
  await cred.save({
    accessToken,
    refreshToken: stringField(body, "refresh_token") ?? cred.refreshToken,
    idToken: stringField(body, "id_token"),
  });
}

function codexAuthPaths() {
  const home = process.env.CODEX_HOME?.trim();
  const homes = home
    ? [expandHome(home)]
    : [join(homedir(), ".config", "codex"), join(homedir(), ".codex")];
  return homes.map((dir) => join(dir, "auth.json"));
}

async function readCodexFile(path: string) {
  const text = await readText(path);
  return text ? codexCredential(text, { kind: "file", path }) : null;
}

async function readCodexKeychain() {
  if (process.platform !== "darwin") return null;
  const service = "Codex Auth";
  allowKeychainWrites(service);
  // The CLI's own item only: a refresh saved beside it signs the CLI out.
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const account = await codexKeychainAccount(expandHome(home));
  const text = await readKeychain(service, account);
  return text
    ? codexCredential(text, { kind: "keychain", service, account })
    : null;
}

async function codexHasApiKeyOnly(paths: string[]) {
  for (const path of paths) {
    const root = asRecord(parseJson((await readText(path)) ?? ""));
    const key = stringField(root, "OPENAI_API_KEY");
    const tokens = asRecord(root?.tokens);
    const access =
      stringField(tokens, "access_token") ?? stringField(tokens, "accessToken");
    if (key && !access) return true;
  }
  return false;
}

function dedupe(credentials: Credential[]) {
  const seen = new Set<string>();
  return credentials.filter((item) => {
    if (seen.has(item.accessToken)) return false;
    seen.add(item.accessToken);
    return true;
  });
}

async function request(
  url: string,
  headers: Record<string, string>,
  body?: string,
) {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("unsupported usage url");
  const response = await fetch(target, {
    method: body == null ? "GET" : "POST",
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("usage request redirected");
  }
  return response;
}

async function jsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function headerNumber(response: Response, name: string) {
  const value = response.headers.get(name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function expandHome(path: string) {
  return path === "~" || path.startsWith("~/")
    ? join(homedir(), path.slice(1))
    : path;
}
