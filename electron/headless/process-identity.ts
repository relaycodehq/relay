// A pid outlives its process: after a restart, WSL's above all, the number
// belongs to whatever started next. Every system Relay runs on says when each
// process started, so a pid recorded with its start only counts for that same
// process.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { win32 } from "node:path";

let boot: string | undefined;
/** This boot of the kernel; process starts count from it, so the two go together. */
const bootId = () =>
  (boot ??= readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());

/** When the process started, in this boot, as Linux counts it; undefined once it's gone. */
function linuxStart(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The name in parentheses may hold spaces; the start is field 22.
    const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    return ticks && `${ticks}@${bootId()}`;
  } catch {
    return undefined;
  }
}

/** The system couldn't be asked, so whether a process still runs is unknown. */
class CouldNotAsk extends Error {}

/**
 * What `file` prints, trimmed; undefined when it prints nothing or exits
 * with 1, as `ps` does for a pid that's gone. Throws `CouldNotAsk` when it
 * failed any other way: timed out, didn't start, or exited otherwise.
 */
function output(file: string, args: string[], env = process.env) {
  try {
    const text = execFileSync(file, args, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      // PowerShell can take seconds while Windows is still signing in.
      timeout: 15_000,
    });
    return text.trim() || undefined;
  } catch (error) {
    if ((error as { status?: unknown }).status === 1) return undefined;
    throw new CouldNotAsk(`${file} didn't answer`, { cause: error });
  }
}

/** When the process started, to the second, as macOS's ps says; undefined once it's gone. */
function macStart(pid: number) {
  const started = output(
    "/bin/ps",
    ["-o", "lstart=", "-p", `${pid}`],
    // The same words and clock whoever asks, so two answers compare.
    { ...process.env, LC_ALL: "C", TZ: "UTC" },
  );
  // A record splits on whitespace, so the start can't hold any.
  return started?.replace(/\s+/g, "-");
}

/** When the process was created, in UTC file time; undefined once it's gone. */
function windowsStart(pid: number) {
  const powershell = win32.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  // CIM rather than Get-Process: an unelevated `relay run` at sign-in can't
  // read when an elevated process started, which Relay may be too. A pid
  // that's gone prints nothing; CIM failing, while Windows is still signing
  // in say, exits with 2.
  const created = output(powershell, [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `try { $p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop } catch { exit 2 }; if ($p) { $p.CreationDate.ToFileTimeUtc() }`,
  ]);
  return created && /^\d+$/.test(created) ? created : undefined;
}

/**
 * When the process started, as this system says; undefined once it's gone.
 * Throws `CouldNotAsk` when the system didn't say.
 */
export function processStart(pid: number): string | undefined {
  if (process.platform === "linux") return linuxStart(pid);
  if (process.platform === "darwin") return macStart(pid);
  if (process.platform === "win32") return windowsStart(pid);
  return undefined;
}

/** When the process started, or undefined when the system didn't say. */
function startIfKnown(pid: number) {
  try {
    return processStart(pid);
  } catch (error) {
    if (error instanceof CouldNotAsk) return undefined;
    throw error;
  }
}

/** This process as a lock or PID file records it: its pid, and its start where known. */
export const recordProcess = (pid = process.pid) =>
  [pid, startIfKnown(pid)].filter(Boolean).join(" ");

/**
 * Whether `record` still names a running process, the same one where its
 * start was kept. A live pid whose start the system wouldn't tell stays its
 * owner's: taking a lock from a running Relay is worse than waiting on one.
 */
export function recordedAlive(record: string, alive: (pid: number) => boolean) {
  const [pidText, start] = record.trim().split(/\s+/);
  const pid = Number(pidText);
  if (!pid || !alive(pid)) return false;
  if (!start) return true;
  try {
    return processStart(pid) === start;
  } catch (error) {
    if (error instanceof CouldNotAsk) return true;
    throw error;
  }
}
