// The Codex CLI's ChatGPT sign-in as Relay reads it for usage, and writes a
// refreshed one back to where the CLI keeps it.
import { stat, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { asRecord } from "../../../shared/records";
import { writeFileAtomic } from "../../util/atomic-write";
import { readKeychain, writeKeychain } from "../keychain";

export type Source =
  | { kind: "file"; path: string }
  | { kind: "keychain"; service: string; account: string };

export type Credential = {
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

export function codexCredential(
  text: string,
  source: Source,
): Credential | null {
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
  const saved = async () => {
    const text =
      input.source.kind === "file"
        ? await readText(input.source.path)
        : await readKeychain(input.source.service, input.source.account);
    return text ? codexCredential(text, input.source) : null;
  };
  const take = (next: Credential) => {
    cred.accessToken = next.accessToken;
    cred.refreshToken = next.refreshToken;
    cred.lastRefresh = next.lastRefresh;
    cred.accountId = next.accountId;
    cred.root = next.root;
  };
  const cred: Credential = {
    ...input,
    reload: async () => {
      const next = await saved();
      if (next) take(next);
    },
    save: async (next) => {
      const now = await saved();
      // Signed in again while the refresh ran: that login stays, and is the one read.
      const loginChanged = !!now && now.refreshToken !== cred.refreshToken;
      if (loginChanged) return take(now);
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

export async function readText(path: string) {
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
  await writeFileAtomic(path, text, { keepMode: true });
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function stringField(
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

export function jwtNumber(token: string, key: string) {
  return numberField(jwtPayload(token), key);
}

function accountFromToken(token: string) {
  const auth = asRecord(jwtPayload(token)?.["https://api.openai.com/auth"]);
  return stringField(auth, "chatgpt_account_id");
}
