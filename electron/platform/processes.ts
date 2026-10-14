// The computer's processes, read the way each OS allows: `ps` on macOS and
// Linux, CIM on Windows through one PowerShell kept running, since starting
// one for every look costs more than the look.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";

export interface ProcessRow {
  pid: number;
  ppid: number;
  /** Its process group; 0 on Windows, which has none. */
  pgid: number;
  /** When it started, ms since the epoch; 0 when the OS didn't say. */
  started: number;
  line: string;
  /** Windows' image name without `.exe`, e.g. "chrome". */
  name?: string;
  /** % of one core now, where the OS keeps a rate (macOS, Windows). */
  cpu?: number;
  /** CPU time it has used, where only a total is kept (Linux); two readings make a rate. */
  cpuMs?: number;
  /** Memory it holds: its resident size, or on Windows its private working set. */
  mb?: number;
}

/**
 * Every process. `usage` also reads what each costs where that takes extra
 * work (Windows' counters, Linux's /proc); memory and macOS's CPU come anyway.
 */
export async function processTable({ usage = false } = {}): Promise<
  ProcessRow[]
> {
  if (process.platform === "win32")
    return parseWindows(await windows.read(usage ? "usage" : "plain"));
  const rows = parsePs(
    await run("ps", [
      "-axww",
      "-o",
      "pid=,ppid=,pgid=,rss=,pcpu=,lstart=,command=",
    ]),
  );
  if (process.platform !== "linux") return rows;
  // Linux's %CPU is an average over the process's whole life.
  for (const row of rows) delete row.cpu;
  if (usage)
    await Promise.all(
      rows.map(async (row) => {
        const ms = await cpuTime(row.pid);
        if (ms !== undefined) row.cpuMs = ms;
      }),
    );
  return rows;
}

/** `ps -o pid=,ppid=,pgid=,rss=,pcpu=,lstart=,command=` in the C locale. */
export function parsePs(out: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const row of out.split("\n")) {
    const m =
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\w{3} \w{3}\s+\d+ [\d:]{8} \d{4})\s+(.*)$/.exec(
        row,
      );
    if (m)
      rows.push({
        pid: +m[1],
        ppid: +m[2],
        pgid: +m[3],
        mb: +m[4] / 1024,
        cpu: +m[5],
        started: Date.parse(m[6]) || 0,
        line: m[7],
      });
  }
  return rows;
}

const END = "--relay-processes-end--";

/** The rows the PowerShell below writes: pid, parent, start, CPU, bytes, name, command line. */
export function parseWindows(out: string): ProcessRow[] {
  return out
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .flatMap((row) => {
      const [pid, ppid, started, cpu, bytes, name, ...rest] = row.split("\t");
      if (!pid || !/^\d+$/.test(pid) || name === undefined) return [];
      const line = rest.join("\t").trim() || name;
      return [
        {
          pid: +pid,
          ppid: +(ppid ?? 0),
          pgid: 0,
          started: +(started ?? 0) || 0,
          line,
          name: name.replace(/\.exe$/i, ""),
          ...(cpu ? { cpu: +cpu } : {}),
          ...(bytes ? { mb: +bytes / 2 ** 20 } : {}),
        },
      ];
    });
}

// Asked "usage", it reads the per-process counters too (snapshot.ts's
// source): already a rate, as % of one core. Tabs and line breaks inside a
// command line become spaces, so a row stays one line.
const windowsScript = `
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$ErrorActionPreference = 'SilentlyContinue'
$t = [char]9
$n = [char]10
while ($null -ne ($ask = [Console]::In.ReadLine())) {
  $perf = @{}
  if ($ask -eq 'usage') {
    foreach ($p in Get-CimInstance Win32_PerfFormattedData_PerfProc_Process) {
      if ($p.Name -ne '_Total' -and $p.Name -ne 'Idle') { $perf[[int]$p.IDProcess] = $p }
    }
  }
  $rows = foreach ($p in Get-CimInstance Win32_Process) {
    $u = $perf[[int]$p.ProcessId]
    $born = 0
    if ($p.CreationDate) { $born = ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() }
    $line = ''
    if ($p.CommandLine) { $line = $p.CommandLine -replace '[\\t\\r\\n]', ' ' }
    $p.ProcessId.ToString() + $t + $p.ParentProcessId + $t + $born + $t + $u.PercentProcessorTime + $t + $u.WorkingSetPrivate + $t + $p.Name + $t + $line
  }
  [Console]::Out.Write(($rows -join $n) + $n + '${END}' + $n)
  [Console]::Out.Flush()
}
`;

/** One PowerShell, asked for a table one request at a time; it quits after a minute unused. */
class WindowsReader {
  private child?: ChildProcess;
  private buffer = "";
  private pending?: (out: string) => void;
  private queue: Promise<unknown> = Promise.resolve();
  private idle?: NodeJS.Timeout;

  read(ask: "usage" | "plain") {
    const next = this.queue.then(() => this.ask(ask));
    this.queue = next;
    return next;
  }

  private ask(ask: string) {
    clearTimeout(this.idle);
    const child = this.start();
    return new Promise<string>((resolve) => {
      const timeout = setTimeout(() => {
        this.stop();
        done("");
      }, 15000);
      const done = (out: string) => {
        clearTimeout(timeout);
        this.pending = undefined;
        this.idle = setTimeout(() => this.stop(), 60000);
        this.idle.unref();
        resolve(out);
      };
      this.pending = done;
      child.stdin?.write(`${ask}\n`);
    });
  }

  private start() {
    if (this.child) return this.child;
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(windowsScript, "utf16le").toString("base64"),
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
    );
    this.child = child;
    this.buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      this.buffer += chunk;
      const end = this.buffer.indexOf(`${END}\n`);
      if (end < 0) return;
      const out = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + END.length + 1);
      this.pending?.(out);
    });
    const gone = () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.pending?.("");
    };
    child.on("error", gone);
    child.on("exit", gone);
    child.stdin?.on("error", () => {});
    return child;
  }

  private stop() {
    const child = this.child;
    this.child = undefined;
    // Its input closing ends the loop; the kill is for one stuck in a query.
    child?.stdin?.end();
    child?.kill();
  }
}

const windows = new WindowsReader();

/** utime + stime from /proc/<pid>/stat, in ms. */
async function cpuTime(pid: number) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
  // The name sits in parentheses and may hold spaces or ")".
  const close = stat.lastIndexOf(")");
  if (close < 0) return;
  const fields = stat.slice(close + 2).split(" ");
  // USER_HZ is 100 on every mainstream kernel.
  return (Number(fields[11]) + Number(fields[12])) * 10;
}

function run(file: string, args: string[]) {
  return new Promise<string>((resolve) => {
    // `lstart` is printed in the user's locale otherwise, and %CPU as 37,1.
    execFile(
      file,
      args,
      {
        maxBuffer: 16 << 20,
        timeout: 5000,
        env: { ...process.env, LC_ALL: "C" },
      },
      (_e, out) => resolve(out ?? ""),
    );
  });
}
