import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import { promisify } from "node:util";
import { processTable } from "../platform/processes";
import { sleep } from "../util/sleep";

const exec = promisify(execFile);

/**
 * What else the computer was doing, so a slow Relay on a busy machine isn't
 * read as Relay's fault. Fields an OS can't tell are left out and shown as
 * unknown; none is guessed.
 */
export interface SystemSnapshot {
  at: number;
  cores: number;
  /** The whole machine, 0–100 across all cores. */
  machineCpu?: number;
  memory: {
    totalMb: number;
    /** What's free for new work, reclaimable caches included. */
    freeMb: number;
    pressure?: "normal" | "warn" | "critical";
    /** Linux PSI: % of the last 10 s some task waited on memory. */
    stalledPct?: number;
  };
  thermal?: {
    /** macOS's own verdict. */
    state?: "nominal" | "fair" | "serious" | "critical";
    /** Linux: the hottest sensor. */
    hottestC?: number;
  };
  onBattery?: boolean;
  lowPower?: boolean;
  /** The busiest programs besides Relay, by name only; % of one core. */
  others?: { name: string; cpu: number }[];
}

/** Electron's own readings, passed in so this module runs anywhere. */
export interface PowerReadings {
  onBattery?(): boolean;
  thermalState?(): string;
}

/** Turns two `os.cpus()` readings into how busy the machine was between them. */
export class MachineCpu {
  private last = cpuTimes();
  /** 0–100 since the previous call; undefined until time has passed. */
  read() {
    const now = cpuTimes();
    const total = now.total - this.last.total;
    const idle = now.idle - this.last.idle;
    this.last = now;
    return total > 0 ? round(100 * (1 - idle / total)) : undefined;
  }
}

function cpuTimes() {
  let total = 0,
    idle = 0;
  for (const { times } of cpus()) {
    total += times.user + times.nice + times.sys + times.idle + times.irq;
    idle += times.idle;
  }
  return { total, idle };
}

/** The cheap parts, fine to take every half minute. */
export async function quickSnapshot(
  machine: MachineCpu,
  power: PowerReadings,
): Promise<SystemSnapshot> {
  const [memory, thermal, lowPower] = await Promise.all([
    memoryNow(),
    thermalNow(power),
    lowPowerNow(),
  ]);
  const onBattery = safe(() => power.onBattery?.());
  return {
    at: Date.now(),
    cores: cpus().length,
    ...defined({ machineCpu: machine.read() }),
    memory,
    ...defined({ thermal, onBattery, lowPower }),
  };
}

/**
 * Also names the busiest other programs, which takes a second or two of
 * looking; for a report or a recording, not the running log.
 */
export async function fullSnapshot(
  power: PowerReadings,
  relayPids: () => number[],
): Promise<SystemSnapshot> {
  const machine = new MachineCpu();
  const [others] = await Promise.all([
    busiestOthers(relayPids).catch(() => undefined),
    sleep(1000),
  ]);
  return { ...(await quickSnapshot(machine, power)), ...defined({ others }) };
}

export async function memoryNow(): Promise<SystemSnapshot["memory"]> {
  const memory: SystemSnapshot["memory"] = {
    totalMb: mb(totalmem()),
    freeMb: mb(freemem()),
  };
  if (process.platform === "darwin") {
    // Free pages alone read near zero on a healthy Mac; this is the share
    // macOS counts as available, as `memory_pressure` prints it.
    const available = Number(
      await run("sysctl", ["-n", "kern.memorystatus_level"]),
    );
    if (available > 0 && available <= 100)
      memory.freeMb = Math.round((memory.totalMb * available) / 100);
    // 1 normal, 2 warn, 4 critical: what macOS itself acts on.
    const level = Number(
      await run("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
    );
    const pressure = ({ 1: "normal", 2: "warn", 4: "critical" } as const)[
      level as 1 | 2 | 4
    ];
    if (pressure) memory.pressure = pressure;
  } else if (process.platform === "linux") {
    const psi = await readFile("/proc/pressure/memory", "utf8").catch(() => "");
    const some = /^some avg10=([\d.]+)/m.exec(psi);
    if (some) memory.stalledPct = Number(some[1]);
  }
  return memory;
}

async function thermalNow(
  power: PowerReadings,
): Promise<SystemSnapshot["thermal"]> {
  if (process.platform === "darwin") {
    const state = safe(() => power.thermalState?.());
    return state === "nominal" ||
      state === "fair" ||
      state === "serious" ||
      state === "critical"
      ? { state }
      : undefined;
  }
  if (process.platform === "linux") {
    const zones = await readdir("/sys/class/thermal").catch(() => []);
    const temps = await Promise.all(
      zones
        .filter((z) => z.startsWith("thermal_zone"))
        .map((z) =>
          readFile(`/sys/class/thermal/${z}/temp`, "utf8").then(
            (t) => Number(t) / 1000,
            () => NaN,
          ),
        ),
    );
    // Sensors that aren't wired report 0 or nonsense.
    const real = temps.filter((t) => t > 0 && t < 150);
    return real.length ? { hottestC: Math.round(Math.max(...real)) } : undefined;
  }
  // Windows only tells an administrator, through WMI.
  return undefined;
}

async function lowPowerNow() {
  if (process.platform === "darwin") {
    const out = await run("pmset", ["-g"]);
    const mode = /^\s*lowpowermode\s+(\d)/m.exec(out ?? "");
    return mode ? mode[1] === "1" : undefined;
  }
  if (process.platform === "linux") {
    // Set by power-profiles-daemon and the desktops' power menus.
    const profile = await readFile(
      "/sys/firmware/acpi/platform_profile",
      "utf8",
    ).catch(() => "");
    return profile.trim() ? /low-power|quiet/.test(profile) : undefined;
  }
  // Windows' battery saver has no cheap reading outside WinRT.
  return undefined;
}

/** The three busiest programs that aren't Relay's own processes. */
async function busiestOthers(relayPids: () => number[]) {
  const mine = new Set([process.pid, ...relayPids()]);
  const all =
    process.platform === "win32"
      ? await windowsProcesses()
      : process.platform === "linux"
        ? await linuxProcesses()
        : await psProcesses();
  // Programs run as several processes; their load counts together.
  const byName = new Map<string, number>();
  for (const p of all) {
    if (mine.has(p.pid) || p.cpu <= 0) continue;
    byName.set(p.name, (byName.get(p.name) ?? 0) + p.cpu);
  }
  return [...byName]
    .map(([name, cpu]) => ({ name, cpu: Math.round(cpu) }))
    .filter((p) => p.cpu >= 1)
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 3);
}

interface Proc {
  pid: number;
  name: string;
  /** % of one core. */
  cpu: number;
}

/** macOS's `ps` %CPU is a short decaying average, close enough to "now". */
async function psProcesses(): Promise<Proc[]> {
  const out = await run("ps", ["-Aco", "pid=,pcpu=,comm="]);
  return (out ?? "").split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(.+)$/.exec(line);
    return m ? [{ pid: Number(m[1]), cpu: Number(m[2]), name: m[3].trim() }] : [];
  });
}

/** Linux's `ps` averages over a process's whole life, so /proc is read twice. */
async function linuxProcesses(): Promise<Proc[]> {
  const tick = 100; // USER_HZ on every mainstream kernel.
  const first = await procTimes();
  const started = Date.now();
  await sleep(1000);
  const second = await procTimes();
  const seconds = (Date.now() - started) / 1000;
  return [...second].flatMap(([pid, now]) => {
    const before = first.get(pid);
    if (!before) return [];
    const cpu = (100 * (now.ticks - before.ticks)) / tick / seconds;
    return [{ pid, name: now.name, cpu }];
  });
}

async function procTimes() {
  const times = new Map<number, { name: string; ticks: number }>();
  const pids = (await readdir("/proc").catch(() => [])).filter((d) =>
    /^\d+$/.test(d),
  );
  await Promise.all(
    pids.map(async (pid) => {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
      // The name sits in parentheses and may hold spaces or ")".
      const open = stat.indexOf("("),
        close = stat.lastIndexOf(")");
      if (open < 0 || close < 0) return;
      const fields = stat.slice(close + 2).split(" ");
      times.set(Number(pid), {
        name: stat.slice(open + 1, close),
        ticks: Number(fields[11]) + Number(fields[12]),
      });
    }),
  );
  return times;
}

/** Windows' own counters: already a rate, per core. */
async function windowsProcesses(): Promise<Proc[]> {
  return (await processTable({ usage: true })).flatMap((p) =>
    p.name && p.cpu !== undefined
      ? [{ pid: p.pid, cpu: p.cpu, name: p.name }]
      : [],
  );
}

async function run(file: string, args: string[], timeout = 3000) {
  try {
    // The C locale, or `ps` writes 37,1 for 37.1 in much of Europe.
    const { stdout } = await exec(file, args, {
      timeout,
      windowsHide: true,
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout;
  } catch {
    return undefined;
  }
}

function safe<T>(read: () => T) {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Leaves out what's undefined, so a snapshot only holds what was read. */
function defined<T extends object>(fields: T) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

const mb = (bytes: number) => Math.round(bytes / 2 ** 20);
const round = (n: number) => Math.round(n * 10) / 10;
