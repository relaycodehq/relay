import type { BugReportFact } from "../../shared/bug-report";
import type { PerfSample } from "./perf-log";
import type { SystemSnapshot } from "./snapshot";

const kindNames: Record<string, string> = {
  main: "the main process",
  window: "the window",
  gpu: "the GPU process",
  utility: "helpers",
  other: "other helpers",
};

/**
 * The performance log and the machine as the report saw it, as rows of the
 * report: Relay's own load next to everything else's, so neither is read as
 * the other.
 */
export function performanceFacts(
  samples: PerfSample[],
  now: SystemSnapshot | undefined,
): BugReportFact[] {
  const fact = (id: string, label: string, value: string): BugReportFact => ({
    id,
    group: "performance",
    label,
    value,
  });
  const facts: BugReportFact[] = [];
  if (samples.length >= 2) {
    const cpu = samples.map(relayCpu);
    const sorted = [...cpu].sort((a, b) => a - b);
    const peakAt = cpu.indexOf(sorted[sorted.length - 1]);
    const peak = samples[peakAt];
    facts.push(
      fact(
        "perf-cpu",
        "Relay's CPU",
        `average ${pct(avg(cpu))}, 95th percentile ${pct(sorted[Math.floor(0.95 * (sorted.length - 1))])}, peak ${pct(cpu[peakAt])} at ${clock(peak.t)}, mostly ${kindNames[busiest(peak, "cpu")] ?? "helpers"}${peak.s.machineCpu === undefined ? "" : `, machine ${Math.round(peak.s.machineCpu)}% busy then`} (% of one core)`,
      ),
    );
    const mem = samples.map(relayMb);
    const memPeakAt = mem.indexOf(Math.max(...mem));
    const last = samples[samples.length - 1];
    facts.push(
      fact(
        "perf-memory",
        "Relay's memory",
        `${size(mem[mem.length - 1])} in ${processes(last)} now, peak ${size(mem[memPeakAt])} at ${clock(samples[memPeakAt].t)}, ${kindNames[busiest(samples[memPeakAt], "mb")] ?? "helpers"} the most`,
      ),
    );
    facts.push(fact("perf-machine", "Machine meanwhile", meanwhile(samples)));
    facts.push(
      fact(
        "perf-span",
        "Performance log",
        `${samples.length.toLocaleString("en-US")} samples, every 30 s from ${clock(samples[0].t)} to ${clock(last.t)}`,
      ),
    );
  } else {
    facts.push(
      fact(
        "perf-span",
        "Performance log",
        "nothing yet: Relay notes its load every 30 s once it's running",
      ),
    );
  }
  if (now) {
    facts.push(fact("perf-now", "Machine now", machineText(now)));
    if (now.others?.length)
      facts.push(
        fact(
          "perf-others",
          "Busiest other programs",
          `${now.others.map((o) => `${o.name} ${o.cpu}%`).join(", ")} (% of one core)`,
        ),
      );
  }
  return facts;
}

/** The machine at one moment, in a line; what the OS can't tell says so. */
export function machineText(s: SystemSnapshot) {
  const { memory } = s;
  const pressure = memory.pressure
    ? `pressure ${memory.pressure}`
    : memory.stalledPct !== undefined
      ? `stalled on memory ${memory.stalledPct}% of the last 10 s`
      : "pressure unknown";
  const thermal = s.thermal?.state
    ? `thermal ${s.thermal.state}`
    : s.thermal?.hottestC !== undefined
      ? `hottest sensor ${s.thermal.hottestC}°C`
      : "thermal unknown";
  const power =
    s.onBattery === undefined
      ? "power source unknown"
      : s.onBattery
        ? "on battery"
        : "plugged in";
  const lowPower =
    s.lowPower === undefined
      ? "low power mode unknown"
      : `low power mode ${s.lowPower ? "on" : "off"}`;
  return [
    `${s.cores} cores${s.machineCpu === undefined ? "" : ` ${Math.round(s.machineCpu)}% busy`}`,
    `${size(memory.totalMb)} memory, ${size(memory.freeMb)} free, ${pressure}`,
    thermal,
    `${power}, ${lowPower}`,
  ].join(" · ");
}

/** How often the machine itself was under strain while the log ran. */
function meanwhile(samples: PerfSample[]) {
  const share = (test: (s: PerfSample["s"]) => boolean | undefined) => {
    const known = samples.filter((x) => test(x.s) !== undefined);
    return known.length
      ? Math.round((100 * known.filter((x) => test(x.s)).length) / known.length)
      : undefined;
  };
  const parts = [
    ["over 80% busy", share((s) => opt(s.machineCpu, (c) => c > 80))],
    [
      "memory under pressure",
      share((s) =>
        s.memory.pressure
          ? s.memory.pressure !== "normal"
          : opt(s.memory.stalledPct, (p) => p > 10),
      ),
    ],
    [
      "running hot",
      share((s) =>
        s.thermal?.state
          ? s.thermal.state === "serious" || s.thermal.state === "critical"
          : opt(s.thermal?.hottestC, (c) => c >= 90),
      ),
    ],
    ["on battery", share((s) => s.onBattery)],
    ["in low power mode", share((s) => s.lowPower)],
  ] as const;
  return parts
    .map(([what, p]) => `${what} ${p === undefined ? "unknown" : `${p}%`}`)
    .join(", ")
    .concat(" of the time");
}

const opt = <T>(v: T | undefined, test: (v: T) => boolean) =>
  v === undefined ? undefined : test(v);

const relayCpu = (s: PerfSample) =>
  Object.values(s.p).reduce((sum, k) => sum + k.cpu, 0);
const relayMb = (s: PerfSample) =>
  Object.values(s.p).reduce((sum, k) => sum + k.mb, 0);
const processes = (s: PerfSample) => {
  const n = Object.values(s.p).reduce((sum, k) => sum + k.n, 0);
  return `${n} ${n === 1 ? "process" : "processes"}`;
};
const busiest = (s: PerfSample, key: "cpu" | "mb") =>
  Object.entries(s.p).sort((a, b) => b[1][key] - a[1][key])[0]?.[0] ?? "";
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (n: number) => `${n < 10 ? Math.round(n * 10) / 10 : Math.round(n)}%`;
const size = (mb: number) =>
  mb >= 1024 ? `${Math.round(mb / 102.4) / 10} GB` : `${Math.round(mb)} MB`;
/** UTC, as the log's own times are. */
const clock = (t: number) =>
  `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
