// Reads the Claude Code / Codex CLI sign-in already on this machine and asks
// each provider for its session and weekly limits. Tokens stay in the main
// process; rotated tokens are written back to the same credential store.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { stat, readFile, writeFile, rename } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  mapClaudeUsage,
  mapCodexUsage,
  providerUsageSchema,
  type ProviderUsage,
  type UsageWindow,
} from "../shared/provider-usage";

const exec = promisify(execFile);
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CLAUDE_SCOPES =
  "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const SUCCESS_TTL = 45_000;
const EMPTY_TTL = 8_000;
const REFRESH_SLACK = 5 * 60 * 1000;

type Provider = "claude" | "codex";
type Source =
  | { kind: "file"; path: string }
  | { kind: "keychain"; service: string; account: string | null };

type Credential = {
  provider: Provider;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  lastRefresh: string | null;
  accountId: string | null;
  scopes: string[] | null;
  source: Source;
  root: Record<string, unknown>;
  reload: () => Promise<void>;
  save: (next: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
    idToken?: string | null;
  }) => Promise<void>;
};

const cache = new Map<Provider, { at: number; value: ProviderUsage }>();
const pending = new Map<Provider, Promise<ProviderUsage>>();
const allowedServices = new Set<string>();

export function readProviderUsage(provider: Provider): Promise<ProviderUsage> {
  const hit = cache.get(provider);
  const ttl = hit?.value.windows.length ? SUCCESS_TTL : EMPTY_TTL;
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
  const existing = pending.get(provider);
  if (existing) return existing;
  const task = load(provider)
    .catch((): ProviderUsage => ({
      provider,
      windows: [],
      message: "Couldn't read usage",
    }))
    .then((value) => {
      const parsed = providerUsageSchema.parse(value);
      cache.set(provider, { at: Date.now(), value: parsed });
      return parsed;
    })
    .finally(() => pending.delete(provider));
  pending.set(provider, task);
  return task;
}

async function load(provider: Provider): Promise<ProviderUsage> {
  if (provider === "claude") return loadClaude();
  return loadCodex();
}

async function loadClaude(): Promise<ProviderUsage> {
  const found = (
    await Promise.all([readClaudeKeychain(), readClaudeFile()])
  ).filter((item): item is Credential => item != null);
  const usable = found.filter(
    (item) => !item.scopes?.length || item.scopes.includes("user:profile"),
  );
  if (!usable.length && found.length) {
    return {
      provider: "claude",
      windows: [],
      message: "Sign in with claude again to read usage",
    };
  }
  const credentials = dedupe(usable);
  const env = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (!credentials.length && env) credentials.push(envClaude(env));
  if (!credentials.length) {
    return {
      provider: "claude",
      windows: [],
      message: "Sign in with claude",
    };
  }
  const endpoints = claudeEndpoints();
  return probe(
    credentials,
    async (token) => {
      const response = await request(endpoints.usage, {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.69",
      });
      return { response, windows: mapClaudeUsage(await jsonBody(response)) };
    },
    (cred, force) => refreshClaude(cred, endpoints, force),
  );
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
  return probe(
    credentials,
    async (token, accountId) => {
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
    },
    (cred, force) => refreshCodex(cred, force),
  );
}

async function probe(
  credentials: Credential[],
  fetchUsage: (
    token: string,
    accountId: string | null,
  ) => Promise<{ response: Response; windows: UsageWindow[] }>,
  refresh: (cred: Credential, force: boolean) => Promise<void>,
): Promise<ProviderUsage> {
  const provider = credentials[0]!.provider;
  let message =
    provider === "claude" ? "Sign in with claude" : "Sign in with codex";
  for (const cred of credentials) {
    try {
      if (needsRefresh(cred, Date.now())) await refresh(cred, false);
      let result = await fetchUsage(cred.accessToken, cred.accountId);
      if (
        (result.response.status === 401 || result.response.status === 403) &&
        cred.refreshToken
      ) {
        await refresh(cred, true);
        result = await fetchUsage(cred.accessToken, cred.accountId);
      }
      if (result.response.status === 429) {
        return { provider, windows: [], message: "Usage is rate limited" };
      }
      if (result.response.status === 401 || result.response.status === 403) {
        message =
          provider === "claude"
            ? "Sign in with claude again to read usage"
            : "Sign in with codex again";
        continue;
      }
      if (!result.response.ok) {
        message = "Couldn't read usage";
        continue;
      }
      return {
        provider,
        windows: result.windows,
        message: result.windows.length ? null : "No usage limits reported",
      };
    } catch {
      message = "Couldn't reach the usage service";
    }
  }
  return { provider, windows: [], message };
}

function needsRefresh(cred: Credential, now: number) {
  if (cred.provider === "claude") {
    return cred.expiresAt != null && cred.expiresAt - now <= REFRESH_SLACK;
  }
  const exp = jwtNumber(cred.accessToken, "exp");
  if (exp != null) return exp * 1000 - now <= REFRESH_SLACK;
  if (!cred.lastRefresh) return false;
  const at = Date.parse(cred.lastRefresh);
  return Number.isFinite(at) && now - at > 8 * 24 * 60 * 60 * 1000;
}

async function refreshClaude(
  cred: Credential,
  endpoints: { refresh: string },
  force: boolean,
) {
  await cred.reload();
  if (!force && !needsRefresh(cred, Date.now())) return;
  if (!cred.refreshToken) return;
  const response = await request(
    endpoints.refresh,
    { "Content-Type": "application/json", Accept: "application/json" },
    JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: cred.refreshToken,
      client_id:
        process.env.CLAUDE_CODE_OAUTH_CLIENT_ID?.trim() || CLAUDE_CLIENT_ID,
      scope: CLAUDE_SCOPES,
    }),
  );
  if (response.status === 401 || response.status === 400) {
    throw new Error("claude refresh rejected");
  }
  if (!response.ok) throw new Error("claude refresh failed");
  const body = asRecord(await jsonBody(response));
  const accessToken = stringField(body, "access_token");
  if (!accessToken) throw new Error("claude refresh failed");
  const expiresIn = numberField(body, "expires_in");
  await cred.save({
    accessToken,
    refreshToken: stringField(body, "refresh_token") ?? cred.refreshToken,
    expiresAt:
      expiresIn == null ? cred.expiresAt : Date.now() + expiresIn * 1000,
  });
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
    expiresAt: null,
    idToken: stringField(body, "id_token"),
  });
}

function claudeEndpoints() {
  const custom = process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL?.trim().replace(
    /\/+$/,
    "",
  );
  if (custom && custom.startsWith("https://")) {
    return {
      usage: `${custom}/api/oauth/usage`,
      refresh: `${custom}/v1/oauth/token`,
    };
  }
  return {
    usage: "https://api.anthropic.com/api/oauth/usage",
    refresh: "https://platform.claude.com/v1/oauth/token",
  };
}

function claudeHome() {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  return override ? expandHome(override) : join(homedir(), ".claude");
}

function claudeServices() {
  const base = "Claude Code-credentials";
  allowedServices.add(base);
  const home = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!home) return [base];
  const scoped = `${base}-${createHash("sha256")
    .update(expandHome(home))
    .digest("hex")
    .slice(0, 8)}`;
  allowedServices.add(scoped);
  return [scoped, base];
}

async function readClaudeFile() {
  return readClaudeText(join(claudeHome(), ".credentials.json"), {
    kind: "file",
    path: join(claudeHome(), ".credentials.json"),
  });
}

async function readClaudeKeychain() {
  if (process.platform !== "darwin") return null;
  for (const service of claudeServices()) {
    const account = currentUser();
    const current = await readKeychain(service, account);
    const parsed = current
      ? claudeCredential(current, {
          kind: "keychain",
          service,
          account,
        })
      : null;
    if (parsed) return parsed;
    const legacy = await readKeychain(service, null);
    const fallback = legacy
      ? claudeCredential(legacy, { kind: "keychain", service, account: null })
      : null;
    if (fallback) return fallback;
  }
  return null;
}

async function readClaudeText(path: string, source: Source) {
  const text = await readText(path);
  return text ? claudeCredential(text, source) : null;
}

function claudeCredential(text: string, source: Source): Credential | null {
  const root = asRecord(parseJson(text));
  if (!root) return null;
  const nested = asRecord(root.claudeAiOauth ?? root.claude_ai_oauth);
  const oauth = nested ?? root;
  const accessToken =
    stringField(oauth, "accessToken") ?? stringField(oauth, "access_token");
  if (!accessToken) return null;
  return makeCredential({
    provider: "claude",
    accessToken,
    refreshToken:
      stringField(oauth, "refreshToken") ?? stringField(oauth, "refresh_token"),
    expiresAt:
      numberField(oauth, "expiresAt") ?? numberField(oauth, "expires_at"),
    lastRefresh: null,
    accountId: null,
    scopes: stringList(oauth.scopes),
    source,
    root,
    oauth,
  });
}

function envClaude(accessToken: string): Credential {
  const cred = makeCredential({
    provider: "claude",
    accessToken,
    refreshToken: null,
    expiresAt: null,
    lastRefresh: null,
    accountId: null,
    scopes: null,
    source: { kind: "file", path: "" },
    root: {},
    oauth: {},
  });
  cred.reload = async () => {};
  cred.save = async () => {};
  return cred;
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
    provider: "codex",
    accessToken,
    refreshToken:
      stringField(tokens, "refresh_token") ??
      stringField(tokens, "refreshToken"),
    expiresAt: null,
    lastRefresh: stringField(root, "last_refresh"),
    accountId,
    scopes: null,
    source,
    root,
    oauth: tokens,
  });
}

function makeCredential(input: {
  provider: Provider;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  lastRefresh: string | null;
  accountId: string | null;
  scopes: string[] | null;
  source: Source;
  root: Record<string, unknown>;
  oauth: Record<string, unknown>;
}): Credential {
  const cred: Credential = {
    ...input,
    reload: async () => {
      const text =
        input.source.kind === "file"
          ? input.source.path
            ? await readText(input.source.path)
            : null
          : await readKeychain(input.source.service, input.source.account);
      if (!text) return;
      const next =
        input.provider === "claude"
          ? claudeCredential(text, input.source)
          : codexCredential(text, input.source);
      if (!next) return;
      cred.accessToken = next.accessToken;
      cred.refreshToken = next.refreshToken;
      cred.expiresAt = next.expiresAt;
      cred.lastRefresh = next.lastRefresh;
      cred.accountId = next.accountId;
      cred.root = next.root;
    },
    save: async (next) => {
      if (input.source.kind === "file" && !input.source.path) return;
      const prefer = input.provider === "claude" ? "camel" : "snake";
      const oauth =
        input.provider === "claude"
          ? (asRecord(cred.root.claudeAiOauth) ??
            asRecord(cred.root.claude_ai_oauth) ??
            cred.root)
          : (asRecord(cred.root.tokens) ?? cred.root);
      setToken(oauth, "accessToken", "access_token", next.accessToken, prefer);
      if (next.refreshToken) {
        setToken(
          oauth,
          "refreshToken",
          "refresh_token",
          next.refreshToken,
          prefer,
        );
      }
      if (input.provider === "claude" && next.expiresAt != null) {
        setToken(oauth, "expiresAt", "expires_at", next.expiresAt, prefer);
      }
      if (input.provider === "codex") {
        if (next.idToken) {
          setToken(oauth, "idToken", "id_token", next.idToken, prefer);
        }
        cred.root.last_refresh = new Date().toISOString();
        cred.lastRefresh = String(cred.root.last_refresh);
      }
      cred.accessToken = next.accessToken;
      cred.refreshToken = next.refreshToken ?? cred.refreshToken;
      cred.expiresAt = next.expiresAt ?? cred.expiresAt;
      const text =
        input.source.kind === "keychain"
          ? JSON.stringify(cred.root)
          : JSON.stringify(cred.root, null, 2);
      if (input.source.kind === "file")
        await writeText(input.source.path, text);
      else
        await writeKeychain(input.source.service, input.source.account, text);
    },
  };
  return cred;
}

function setToken(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
  value: unknown,
  prefer: "camel" | "snake",
) {
  if (prefer === "snake") {
    if (camel in record && !(snake in record)) record[camel] = value;
    else record[snake] = value;
    return;
  }
  if (snake in record && !(camel in record)) record[snake] = value;
  else record[camel] = value;
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
  if (!path.endsWith("/auth.json") && !path.endsWith("/.credentials.json")) {
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

function stringList(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
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

function currentUser() {
  return process.env.USER?.trim() || userInfo().username;
}

function expandHome(path: string) {
  return path === "~" || path.startsWith("~/")
    ? join(homedir(), path.slice(1))
    : path;
}
