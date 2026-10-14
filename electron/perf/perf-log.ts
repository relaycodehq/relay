import { appendFile, mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  MachineCpu,
  quickSnapshot,
  type PowerReadings,
  type SystemSnapshot,
} from "./snapshot";

/** One of Relay's processes as Electron measures it. */
export interface ProcessReading {
  pid: number;
  /** Electron's process type: "Browser", "Tab", "GPU", "Utility"… */
  type: string;
  /** % of one core since the last reading. */
  cpu: number;
  /** Working set. */
  mb: number;
}

/** A line of the log: Relay's processes by kind, and the machine around them. */
export interface PerfSample {
  t: number;
  /** By process kind: % of one core, MB, and how many. */
  p: Record<string, { cpu: number; mb: number; n: number }>;
  s: Omit<SystemSnapshot, "at" | "others">;
}

export const sampleEvery = 30_000;
/** Each file covers half the day, so the two together cover 12–24 hours. */
const fileSpan = 12 * 3600_000;
export const logFiles = ["perf.old.jsonl", "perf.jsonl"] as const;

/**
 * Relay's own CPU and memory every half minute, with what the machine was
 * doing, kept for about a day in the logs folder. Only ever read by the
 * problem report, and only sent if the user sends it.
 */
export class PerfLog {
  private timer?: NodeJS.Timeout;
  private machine = new MachineCpu();
  private started?: number;
  private writing: Promise<unknown> = Promise.resolve();

  constructor(
    private deps: {
      dir: string;
      metrics(): ProcessReading[];
      power: PowerReadings;
      now?: () => number;
    },
  ) {}

  private get now() {
    return this.deps.now?.() ?? Date.now();
  }

  start() {
    if (this.timer) return;
    // The first reading primes Electron's and the OS's CPU counters.
    this.deps.metrics();
    this.machine.read();
    this.timer = setInterval(() => void this.sample(), sampleEvery);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async sample() {
    const { at: _, ...system } = await quickSnapshot(
      this.machine,
      this.deps.power,
    );
    const sample: PerfSample = {
      t: this.now,
      p: byKind(this.deps.metrics()),
      s: system,
    };
    this.writing = this.writing
      .then(() => this.append(sample))
      .catch((e) => console.warn("Could not write the performance log:", e));
    return this.writing;
  }

  private async append(sample: PerfSample) {
    const current = join(this.deps.dir, logFiles[1]);
    this.started ??= await firstTime(current);
    if (this.started !== undefined && sample.t - this.started > fileSpan) {
      await rename(current, join(this.deps.dir, logFiles[0])).catch(() => {});
      this.started = undefined;
    }
    await mkdir(this.deps.dir, { recursive: true });
    await appendFile(current, `${JSON.stringify(sample)}\n`, { mode: 0o600 });
    this.started ??= sample.t;
  }

  /** The last day's samples, oldest first. */
  async read(): Promise<PerfSample[]> {
    await this.writing;
    return readSamples(this.deps.dir, this.now);
  }
}

export async function readSamples(dir: string, now: number) {
  const texts = await Promise.all(
    logFiles.map((f) => readFile(join(dir, f), "utf8").catch(() => "")),
  );
  return parseSamples(texts.join("\n"), now);
}

export function parseSamples(text: string, now: number): PerfSample[] {
  return text.split("\n").flatMap((line) => {
    if (!line) return [];
    try {
      const sample = JSON.parse(line) as PerfSample;
      // A day back; a clock set back leaves nothing from "the future".
      return typeof sample.t === "number" &&
        sample.t > now - 24 * 3600_000 &&
        sample.t <= now + 60_000
        ? [sample]
        : [];
    } catch {
      // A line cut short by a crash.
      return [];
    }
  });
}

async function firstTime(file: string) {
  const text = await readFile(file, "utf8").catch(() => "");
  const first = text.slice(0, text.indexOf("\n"));
  try {
    return (JSON.parse(first) as PerfSample).t;
  } catch {
    return undefined;
  }
}

const kinds: Record<string, string> = {
  Browser: "main",
  Tab: "window",
  GPU: "gpu",
  Utility: "utility",
};

/** Relay's processes added up by kind: windows together, helpers together. */
export function byKind(readings: ProcessReading[]) {
  const out: PerfSample["p"] = {};
  for (const r of readings) {
    const kind = kinds[r.type] ?? "other";
    const k = (out[kind] ??= { cpu: 0, mb: 0, n: 0 });
    k.cpu += r.cpu;
    k.mb += r.mb;
    k.n++;
  }
  for (const k of Object.values(out)) {
    k.cpu = Math.round(k.cpu * 10) / 10;
    k.mb = Math.round(k.mb);
  }
  return out;
}
