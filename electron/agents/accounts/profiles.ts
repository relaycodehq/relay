// An extra account's config folder. It links everything the CLI keeps in its
// usual home (sessions, settings, CLAUDE.md, skills, plugins) except the
// sign-in, so a conversation started on one account resumes on another and
// the user's setup comes along. Only the credentials are the account's own.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  SYSTEM_ACCOUNT,
  type AccountProvider,
} from "../../../shared/agent-accounts";

const exec = promisify(execFile);

/** The account's own sign-in, never linked from the usual home. */
const OWN: Record<AccountProvider, Set<string>> = {
  claude: new Set([".credentials.json", ".claude.json", ".DS_Store"]),
  codex: new Set(["auth.json", ".DS_Store"]),
};
/** Credentials a profile must not inherit from Relay's own environment. */
const ENV_CREDENTIALS: Record<AccountProvider, string[]> = {
  claude: [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ],
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"],
};

let root: string | undefined;
/** Where profiles live: Relay's own data folder, set as the app starts. */
export function setProfilesRoot(dir: string) {
  root = dir;
}

const expand = (path: string) =>
  path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;

/** Where the CLI keeps its usual sign-in and everything else. */
export function usualHome(provider: AccountProvider) {
  if (provider === "claude")
    return expand(process.env.CLAUDE_CONFIG_DIR?.trim() || "~/.claude");
  return expand(process.env.CODEX_HOME?.trim() || "~/.codex");
}

export function profileDir(provider: AccountProvider, id: string) {
  if (!root) throw new Error("Relay is still starting.");
  if (id === SYSTEM_ACCOUNT || !/^[a-z0-9-]{1,40}$/.test(id))
    throw new Error("Not an account folder.");
  return join(root, provider, id);
}

/**
 * Makes the folder and links in whatever the usual home has that it lacks.
 * Run before each launch: the CLI may have added files since, and a link
 * the CLI replaced with a file of its own stays the account's.
 */
export async function prepareProfile(provider: AccountProvider, id: string) {
  const dir = profileDir(provider, id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const home = usualHome(provider);
  const [theirs, mine] = await Promise.all([
    readdir(home).catch(() => [] as string[]),
    readdir(dir),
  ]);
  const have = new Set(mine);
  await Promise.all(
    theirs
      .filter((name) => !OWN[provider].has(name) && !have.has(name))
      .map((name) =>
        symlink(join(home, name), join(dir, name)).catch((e) => {
          // Another launch linked it first.
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }),
      ),
  );
  return dir;
}

/** What a process for the account adds to Relay's environment. */
export function accountEnv(
  provider: AccountProvider,
  id: string,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env = { ...base } as Record<string, string>;
  if (id === SYSTEM_ACCOUNT) return env;
  const dir = profileDir(provider, id);
  for (const key of ENV_CREDENTIALS[provider]) delete env[key];
  if (provider === "claude") {
    env.CLAUDE_CONFIG_DIR = dir;
    // Claude Code names the Keychain item after this folder.
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR = dir;
  } else env.CODEX_HOME = dir;
  return env;
}

/** Claude Code's Keychain item for a config folder, as the CLI names it. */
export function claudeKeychainService(dir: string) {
  const hash = createHash("sha256")
    .update(dir.normalize("NFC"))
    .digest("hex")
    .slice(0, 8);
  return `Claude Code-credentials-${hash}`;
}

/** Signs the account out for good: its folder, and Claude's Keychain item. */
export async function removeProfile(provider: AccountProvider, id: string) {
  const dir = profileDir(provider, id);
  if (provider === "claude" && process.platform === "darwin")
    await exec("/usr/bin/security", [
      "delete-generic-password",
      "-s",
      claudeKeychainService(dir),
    ]).catch(() => {
      // Never signed in, or already gone.
    });
  const info = await lstat(dir).catch(() => null);
  // Removes the links, not what they point at.
  if (info?.isDirectory()) await rm(dir, { recursive: true, force: true });
}
