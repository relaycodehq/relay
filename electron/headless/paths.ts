import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
  if (Buffer.byteLength(inHome) < 100) return inHome;
  // An unstarted home has no endpoint. A fresh unoccupied name makes the
  // CLI report NotRunning without connecting to a guessable foreign socket.
  return (
    recordedSocket(home) ??
    join("/tmp", `relay-${randomUUID()}`, "control.sock")
  );
}

function recordedSocket(home: string) {
  try {
    const path = readFileSync(join(home, "control-path"), "utf8").trim();
    const prefix = `/tmp/relay-${process.getuid?.() ?? "user"}-`;
    if (
      !path.startsWith(prefix) ||
      !/^[A-Za-z0-9]+\/control\.sock$/.test(path.slice(prefix.length))
    )
      throw new Error("Invalid Relay control socket path.");
    const directory = lstatSync(dirname(path));
    // Temporary directories may disappear at reboot. Never reconnect to a
    // replacement directory owned by another user, or through a symlink.
    if (
      !directory.isDirectory() ||
      directory.uid !== process.getuid!() ||
      (directory.mode & 0o077) !== 0
    )
      return undefined;
    return path;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/** Called only by the daemon holding the home lock, before serving control. */
export async function prepareControlSocket(home: string) {
  if (
    process.platform === "win32" ||
    Buffer.byteLength(join(home, "relay.sock")) < 100
  )
    return controlSocket(home);
  const existing = recordedSocket(home);
  if (existing) return existing;
  // mkdtemp creates the private directory atomically. Clients discover the
  // random name through the protected home, never a predictable /tmp entry.
  const directory = await mkdtemp(
    `/tmp/relay-${process.getuid?.() ?? "user"}-`,
  );
  const path = join(directory, "control.sock");
  const temporary = join(home, `control-path.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, path + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, join(home, "control-path"));
  } catch (e) {
    await rm(directory, { recursive: true, force: true });
    throw e;
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
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
