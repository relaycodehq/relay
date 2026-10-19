// A pid outlives its process: after a restart, WSL's above all, the number
// belongs to whatever started next. Linux says when each process started, so
// a pid recorded with its start only counts for that same process.
import { readFileSync } from "node:fs";

let boot: string | undefined;
/** This boot of the kernel; process starts count from it, so the two go together. */
const bootId = () =>
  (boot ??= readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());

/** When the process started, in this boot, as Linux counts it; undefined elsewhere or once it's gone. */
export function processStart(pid: number): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The name in parentheses may hold spaces; the start is field 22.
    const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    return ticks && `${ticks}@${bootId()}`;
  } catch {
    return undefined;
  }
}

/** This process as a lock or PID file records it: its pid, and its start where known. */
export const recordProcess = (pid = process.pid) =>
  [pid, processStart(pid)].filter(Boolean).join(" ");

/** Whether `record` still names a running process, the same one where its start was kept. */
export function recordedAlive(record: string, alive: (pid: number) => boolean) {
  const [pidText, start] = record.trim().split(/\s+/);
  const pid = Number(pidText);
  if (!pid || !alive(pid)) return false;
  return !start || processStart(pid) === start;
}
