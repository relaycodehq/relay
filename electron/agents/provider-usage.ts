// Session and weekly limits for the signed-in accounts. Claude Code reports its
// own through the Agent SDK. For Codex, Relay reads the CLI's sign-in and asks
// ChatGPT; tokens stay in the main process and rotated ones are written back to
// the same credential store.
import { execFile } from "node:child_process";
import { stat, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import {
  mapClaudeUsage,
  mapCodexUsage,
  providerUsageSchema,
  type ProviderUsage,
  type UsageWindow,
} from "../../shared/provider-usage";
import { readClaudeUsage } from "../rooms/claude-project";
import type { UsageProvider } from "../../shared/agents";
import { recordUsage } from "./usage-history";

const exec = promisify(execFile);
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const SUCCESS_TTL = 45_000;
const EMPTY_TTL = 8_000;
// Without a running session, each Claude reading starts the CLI.
const CLAUDE_TTL = 150_000;
const REFRESH_SLACK = 5 * 60 * 1000;

type Source =
  | { kind: "file"; path: string }
  | { kind: "keychain"; service: string; account: string | null };

type Credential = {
  accessToken: string;
  refreshToken: string | null;
  lastRefresh: string | null;
  accountId: string | null;
  source: Source;
  root: Record<string, unknown>;
  reload: () => Promise<void>;
  save: (next: {
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
  }) => Promise<void>;
};

const cache = new Map<UsageProvider, { at: number; value: ProviderUsage }>();
const pending = new Map<UsageProvider, Promise<ProviderUsage>>();
const allowedServices = new Set<string>();

/** How to read each agent's usage, and how long a reading holds. */
const readers: Record<
  UsageProvider,
  { load: () => Promise<ProviderUsage>; ttl?: number }
> = {
  claude: { load: loadClaude, ttl: CLAUDE_TTL },
  codex: { load: loadCodex },
};

export function readProviderUsage(
  provider: UsageProvider,
  force = false,
): Promise<ProviderUsage> {
  const hit = cache.get(provider);
  const ttl =
    readers[provider].ttl ??
    (hit?.value.windows.length ? SUCCESS_TTL : EMPTY_TTL);
  if (!force && hit && Date.now() - hit.at < ttl) {
    return Promise.resolve(hit.value);
  }
  const existing = pending.get(provider);
  if (existing) return existing;
  const task = readers[provider]
    .load()
    .catch((): ProviderUsage => ({
      provider,
      windows: [],
      message: "Couldn't read usage",
    }))
    .then(async (value) => {
      const activeHours = await recordUsage(value).catch(() => null);
      const parsed = providerUsageSchema.parse({ ...value, activeHours });
      cache.set(provider, { at: Date.now(), value: parsed });
      return parsed;
    })
    .finally(() => pending.delete(provider));
  pending.set(provider, task);
  return task;
}

async function loadClaude(): Promise<ProviderUsage> {
  const usage = await readClaudeUsage();
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

async function loadCodex(): Promise<ProviderUsage> {
  const files = (
    await Promise.all(codexAuthPaths().map((path) => readCodexFile(path)))
  ).filter((item): item is Credential => item != null);
  const keychain = await readCodexKeychain();
  const credentials = dedupe(
    [...files, keychain].filter((item): item is Credential => item != null),
  );
  if (!credentials.length) {
    const apiKey = await codexHasApiKeyOnly();
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
    return {
      response,
      windows: mapCodexUsage(await jsonBody(response), Date.now(), {
        primary: headerNumber(response, "x-codex-primary-used-percent"),
        secondary: headerNumber(response, "x-codex-secondary-used-percent"),
      }),
    };
  });
}

async function probe(
  credentials: Credential[],
  fetchUsage: (
    token: string,
    accountId: string | null,
  ) => Promise<{ response: Response; windows: UsageWindow[] }>,
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
  allowedServices.add(service);
  const text = await readKeychain(service, null);
  return text
    ? codexCredential(text, { kind: "keychain", service, account: null })
    : null;
}

async function codexHasApiKeyOnly() {
  for (const path of codexAuthPaths()) {
    const root = asRecord(parseJson((await readText(path)) ?? ""));
    const key = stringField(root, "OPENAI_API_KEY");
    const tokens = asRecord(root?.tokens);
    const access =
      stringField(tokens, "access_token") ?? stringField(tokens, "accessToken");
    if (key && !access) return true;
  }
  return false;
}

function codexCredential(text: string, source: Source): Credential | null {
  const root = asRecord(parseJson(text));
  const tokens = asRecord(root?.tokens);
  if (!root || !tokens) return null;
  const accessToken =
    stringField(tokens, "access_token") ?? stringField(tokens, "accessToken");
  if (!accessToken) return null;
  const accountId =
    stringField(tokens, "account_id") ??
    stringField(tokens, "accountId") ??
    accountFromToken(accessToken);
  return makeCredential({
    accessToken,
    refreshToken:
      stringField(tokens, "refresh_token") ??
      stringField(tokens, "refreshToken"),
    lastRefresh: stringField(root, "last_refresh"),
    accountId,
    source,
    root,
  });
}

function makeCredential(input: {
  accessToken: string;
  refreshToken: string | null;
  lastRefresh: string | null;
  accountId: string | null;
  source: Source;
  root: Record<string, unknown>;
}): Credential {
  const cred: Credential = {
    ...input,
    reload: async () => {
      const text =
        input.source.kind === "file"
          ? await readText(input.source.path)
          : await readKeychain(input.source.service, input.source.account);
      if (!text) return;
      const next = codexCredential(text, input.source);
      if (!next) return;
      cred.accessToken = next.accessToken;
      cred.refreshToken = next.refreshToken;
      cred.lastRefresh = next.lastRefresh;
      cred.accountId = next.accountId;
      cred.root = next.root;
    },
    save: async (next) => {
      const tokens = asRecord(cred.root.tokens) ?? cred.root;
      setToken(tokens, "accessToken", "access_token", next.accessToken);
      if (next.refreshToken) {
        setToken(tokens, "refreshToken", "refresh_token", next.refreshToken);
      }
      if (next.idToken) setToken(tokens, "idToken", "id_token", next.idToken);
      cred.root.last_refresh = new Date().toISOString();
      cred.lastRefresh = String(cred.root.last_refresh);
      cred.accessToken = next.accessToken;
      cred.refreshToken = next.refreshToken ?? cred.refreshToken;
      if (input.source.kind === "file")
        await writeText(input.source.path, JSON.stringify(cred.root, null, 2));
      else
        await writeKeychain(
          input.source.service,
          input.source.account,
          JSON.stringify(cred.root),
        );
    },
  };
  return cred;
}

/** Keeps the key style the CLI wrote; snake_case when it wrote neither. */
function setToken(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
  value: unknown,
) {
  if (camel in record && !(snake in record)) record[camel] = value;
  else record[snake] = value;
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

async function readText(path: string) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > 1_000_000) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function writeText(path: string, text: string) {
  if (basename(path) !== "auth.json") {
    throw new Error("refusing credential write");
  }
  const mode = await stat(path)
    .then((info) => info.mode & 0o777)
    .catch(() => 0o600);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, { mode });
  await rename(tmp, path);
}

async function readKeychain(service: string, account: string | null) {
  const args = ["find-generic-password", "-s", service, "-w"];
  if (account) args.splice(1, 0, "-a", account);
  const result = await security(args);
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

async function writeKeychain(
  service: string,
  account: string | null,
  value: string,
) {
  if (!allowedServices.has(service)) throw new Error("refusing keychain write");
  const args = ["add-generic-password", "-U", "-s", service, "-w", value];
  if (account) args.splice(2, 0, "-a", account);
  const result = await security(args);
  if (result.status !== 0) throw new Error("keychain update failed");
}

function security(args: string[]) {
  return exec("/usr/bin/security", args, {
    timeout: 12_000,
    maxBuffer: 2 * 1024 * 1024,
  }).then(
    ({ stdout }) => ({ status: 0, stdout: String(stdout) }),
    (error: { status?: number; stdout?: string }) => ({
      status: typeof error.status === "number" ? error.status : 1,
      stdout: String(error.stdout ?? ""),
    }),
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(
  record: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jwtPayload(token: string) {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return asRecord(
      JSON.parse(Buffer.from(part, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}

function jwtNumber(token: string, key: string) {
  return numberField(jwtPayload(token), key);
}

function accountFromToken(token: string) {
  const auth = asRecord(jwtPayload(token)?.["https://api.openai.com/auth"]);
  return stringField(auth, "chatgpt_account_id");
}

function expandHome(path: string) {
  return path === "~" || path.startsWith("~/")
    ? join(homedir(), path.slice(1))
    : path;
}
