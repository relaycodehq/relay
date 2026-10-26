// WSL stops a distribution 15 s (`instanceIdleTimeout`) after the last
// Windows program using it exits, and Relay running in it goes with it. A
// Windows Relay holds the distributions it uses awake; for a Relay in WSL
// that nothing on Windows holds, `.wslconfig` can turn the timeout off.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { writeFileAtomic } from "../util/atomic-write";

const run = promisify(execFile);

/** The WSL distribution this runs in, if it does. */
export function wslDistro(
  env: NodeJS.ProcessEnv = process.env,
  version = readProcVersion(),
): string | undefined {
  return /microsoft/i.test(version) ? env.WSL_DISTRO_NAME : undefined;
}

/** The port a Relay in mirrored WSL takes, beside the desktop Relay's on Windows. */
export const mirroredWslPort = 47822;

/**
 * Whether this runs in WSL with mirrored networking, which shares Windows'
 * addresses and ports: a port taken in here is taken on Windows too.
 */
export async function sharesWindowsNetwork(version = readProcVersion()) {
  if (!/microsoft/i.test(version)) return false;
  const mode = await run("wslinfo", ["--networking-mode"], {
    timeout: 5_000,
  }).then(
    ({ stdout }) => stdout.trim(),
    () => "",
  );
  return mode === "mirrored";
}

function readProcVersion() {
  try {
    return readFileSync("/proc/version", "utf8");
  } catch {
    return "";
  }
}

const generalHeader = /^\s*\[general\]\s*$/i;
const idleKey = /^\s*instanceIdleTimeout\s*=/i;

/** Whether `.wslconfig` already keeps distributions up however long they're idle. */
export function idleShutdownOff(config: string) {
  let general = false;
  for (const line of config.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) general = generalHeader.test(line);
    else if (general && idleKey.test(line))
      return line.split("=")[1]!.trim() === "-1";
  }
  return false;
}

/** `.wslconfig` with idle distributions left running, everything else as it was. */
export function withoutIdleShutdown(config: string) {
  const eol = config.includes("\r\n") ? "\r\n" : "\n";
  const lines = config.split(/\r?\n/);
  const header = lines.findIndex((line) => generalHeader.test(line));
  if (header < 0)
    return `[general]${eol}instanceIdleTimeout=-1${eol}${config ? eol + config : ""}`;
  let end = lines.findIndex((line, i) => i > header && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;
  const key = lines.findIndex(
    (line, i) => i > header && i < end && idleKey.test(line),
  );
  if (key >= 0) lines[key] = "instanceIdleTimeout=-1";
  else lines.splice(header + 1, 0, "instanceIdleTimeout=-1");
  return lines.join(eol);
}

/** A Windows environment variable's folder, as a path here. */
async function windowsFolder(variable: string) {
  // From a Windows folder, or cmd.exe complains about the Linux one it starts in.
  const { stdout } = await run("cmd.exe", ["/d", "/c", `echo %${variable}%`], {
    cwd: "/mnt/c",
    timeout: 10_000,
  });
  const path = stdout.trim();
  if (!path || path.includes("%"))
    throw new Error(`Windows didn't say where ${variable} is.`);
  return (await run("wslpath", ["-u", path])).stdout.trim();
}

/**
 * Turns WSL's idle shutdown off in the Windows user's `.wslconfig`, for every
 * distribution; it applies from WSL's next start. Returns the file it wrote,
 * or undefined when it was off already.
 */
export async function keepDistributionsUp() {
  const file = join(await windowsFolder("USERPROFILE"), ".wslconfig");
  // Only a missing file is an empty one; any other failure keeps what's there.
  const config = await readFile(file, "utf8").catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return "";
      throw e;
    },
  );
  if (idleShutdownOff(config)) return undefined;
  await writeFileAtomic(file, withoutIdleShutdown(config), { keepMode: true });
  return file;
}
