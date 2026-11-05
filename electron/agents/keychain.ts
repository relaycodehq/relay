// The macOS Keychain through `security`, for the sign-ins usage reads refresh.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Services a refreshed sign-in may be written back to; nothing else is touched. */
const allowedServices = new Set<string>();

export function allowKeychainWrites(service: string) {
  allowedServices.add(service);
}

/**
 * The account the Codex CLI files its keyring sign-in under for `codexHome`:
 * "cli|" and the first 16 hex digits of the SHA-256 of the folder's real path
 * (`compute_store_key` in codex-rs/login/src/auth/storage.rs). Derived, not
 * looked up: the first "Codex Auth" item may belong to another home.
 */
export async function codexKeychainAccount(codexHome: string) {
  const path = await realpath(codexHome).catch(() => codexHome);
  const digest = createHash("sha256").update(path).digest("hex");
  return `cli|${digest.slice(0, 16)}`;
}

export async function readKeychain(service: string, account: string) {
  const args = ["find-generic-password", "-s", service, "-a", account, "-w"];
  const result = await security(args);
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export async function writeKeychain(
  service: string,
  account: string,
  value: string,
) {
  if (!allowedServices.has(service)) throw new Error("refusing keychain write");
  const args = ["add-generic-password", "-U", "-s", service, "-a", account];
  args.push("-w", value);
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
