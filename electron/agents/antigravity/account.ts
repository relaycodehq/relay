import { access, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { runExecutable } from "../../platform/executables";

export const antigravityHome = (env: NodeJS.ProcessEnv = process.env) =>
  env.GEMINI_HOME || join(homedir(), ".gemini");

export async function antigravityAuthMethod(home = antigravityHome()) {
  const settings = await readFile(
    join(home, "antigravity-acp", "settings.json"),
    "utf8",
  )
    .then((text) => JSON.parse(text) as { auth?: { type?: unknown } })
    .catch(() => undefined);
  return typeof settings?.auth?.type === "string"
    ? settings.auth.type
    : undefined;
}

/** Checks only whether credentials exist; never reads a secret out of the Keychain. */
export async function readAntigravityAccount(
  home = antigravityHome(),
  fileStorage = !!process.env.AGY_ACP_FORCE_FILE_STORAGE,
): Promise<{ signedIn: boolean } | undefined> {
  const choice = await antigravityAuthMethod(home);
  if (!choice) return { signedIn: false };
  if (choice !== "oauth-personal" && choice !== "oauth-business")
    return undefined;
  if (
    await access(join(home, "antigravity-acp", "acp_token.json")).then(
      () => true,
      () => false,
    )
  )
    return { signedIn: true };
  if (process.platform !== "darwin" || fileStorage) return { signedIn: false };
  const found = await runExecutable(
    "/usr/bin/security",
    ["find-generic-password", "-s", "gemini", "-a", "antigravity-acp"],
    5000,
  ).catch(() => undefined);
  if (found?.code === 0) return { signedIn: true };
  return found?.code === 44 ? { signedIn: false } : undefined;
}

/** Notices external sign-ins/settings changes without reading a Keychain secret. */
export async function antigravityCredentialRevision(
  home: string,
  fileStorage: boolean,
) {
  const parts = await Promise.all(
    ["settings.json", "acp_token.json"].map(async (name) => {
      const info = await stat(join(home, "antigravity-acp", name)).catch(
        () => undefined,
      );
      return info
        ? `${name}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
        : name;
    }),
  );
  if (
    process.platform === "darwin" &&
    !fileStorage &&
    !(await access(join(home, "antigravity-acp", "acp_token.json")).then(
      () => true,
      () => false,
    ))
  ) {
    const metadata = await runExecutable(
      "/usr/bin/security",
      ["find-generic-password", "-s", "gemini", "-a", "antigravity-acp"],
      5000,
    ).catch(() => undefined);
    parts.push(metadata?.stdout ?? "");
  }
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}
