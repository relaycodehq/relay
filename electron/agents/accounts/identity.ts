// Who an account signs in as, read from what its CLI saved on disk. Nothing
// goes over the network and no token leaves the file.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  SYSTEM_ACCOUNT,
  type AccountProvider,
} from "../../../shared/agent-accounts";
import { profileDir, usualHome } from "./profiles";

export interface AccountIdentity {
  signedIn: boolean;
  email?: string;
  plan?: string;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}
const text = (record: unknown, key: string) => {
  const value = (record as Record<string, unknown> | null)?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};
const capital = (value: string) => value[0]!.toUpperCase() + value.slice(1);

/** Claude Code's `oauthAccount`: organizationType reads claude_max, claude_pro… */
export function claudeIdentity(config: unknown): AccountIdentity {
  const account = (config as Record<string, unknown> | null)?.oauthAccount;
  if (!account || typeof account !== "object") return { signedIn: false };
  const kind = text(account, "organizationType");
  return {
    signedIn: true,
    email: text(account, "emailAddress"),
    plan: kind ? capital(kind.replace(/^claude_/, "")) : undefined,
  };
}

/** The claims in Codex's `id_token`; an API key alone has no account to show. */
export function codexIdentity(auth: unknown): AccountIdentity {
  const tokens = (auth as Record<string, unknown> | null)?.tokens;
  const idToken = text(tokens, "id_token") ?? text(tokens, "idToken");
  if (!idToken) return { signedIn: !!text(tokens, "access_token") };
  let claims: Record<string, unknown> | null = null;
  try {
    claims = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
  } catch {}
  const openai = claims?.["https://api.openai.com/auth"];
  const plan = text(openai, "chatgpt_plan_type");
  return {
    signedIn: true,
    email:
      text(claims, "email") ??
      text(claims?.["https://api.openai.com/profile"], "email"),
    plan: plan ? capital(plan) : undefined,
  };
}

export async function readIdentity(
  provider: AccountProvider,
  id: string,
): Promise<AccountIdentity> {
  const system = id === SYSTEM_ACCOUNT;
  if (provider === "claude") {
    // The usual sign-in keeps its config beside ~/.claude, not in it.
    const path =
      system && !process.env.CLAUDE_CONFIG_DIR?.trim()
        ? join(homedir(), ".claude.json")
        : join(system ? usualHome("claude") : profileDir("claude", id), ".claude.json");
    return claudeIdentity(await readJson(path));
  }
  const dir = system ? usualHome("codex") : profileDir("codex", id);
  return codexIdentity(await readJson(join(dir, "auth.json")));
}
