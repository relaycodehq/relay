import { createHash } from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Where a headless Relay keeps everything: its threads, settings, keys and
 * logs. One folder, `~/.relay` unless RELAY_HOME (or `--home`) says
 * otherwise, so a server's Relay is easy to find, back up and move.
 */
export function relayHome(env: NodeJS.ProcessEnv = process.env) {
  return resolve(env.RELAY_HOME || join(homedir(), ".relay"));
}

export function headlessPaths(home: string) {
  return {
    home,
    logs: join(home, "logs"),
    log: join(home, "logs", "relay.log"),
    pid: join(home, "relay.pid"),
    config: join(home, "headless.json"),
    secretKey: join(home, "secret.key"),
    control: controlSocket(home),
  };
}

/**
 * The socket the `relay` command talks to the running Relay through. Unix
 * sockets live in the home folder (0700, so only this user reaches them)
 * unless its path is too long for one; Windows uses a named pipe.
 */
export function controlSocket(home: string, platform = process.platform) {
  const id = createHash("sha256").update(home).digest("hex").slice(0, 16);
  if (platform === "win32") return `\\\\.\\pipe\\relay-${id}`;
  const inHome = join(home, "relay.sock");
  // macOS allows 104 bytes for a socket path, Linux 108.
  return Buffer.byteLength(inHome) < 100
    ? inHome
    : join(
        "/tmp",
        `relay-${process.getuid?.() ?? "user"}-${id}`,
        "control.sock",
      );
}

/** Creates a private directory, and secures an existing one before using it. */
export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    (process.platform !== "win32" && info.uid !== process.getuid!())
  )
    throw new Error(`Relay needs a directory owned by this user: ${path}`);
  if (process.platform !== "win32") await chmod(path, 0o700);
}
