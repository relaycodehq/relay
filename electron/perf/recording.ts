import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { Session } from "node:inspector";
import { join } from "node:path";
import { strToU8, zip, type Zippable } from "fflate";
import { byKind, type PerfSample, type ProcessReading } from "./perf-log";
import { fullSnapshot, MachineCpu, quickSnapshot } from "./snapshot";
import type { PowerReadings, SystemSnapshot } from "./snapshot";
import { machineText } from "./summary";

/** GitHub takes attachments up to 25 MB. */
export const recordingLimit = 25_000_000;
export const recordingFile = "performance.zip";

/** Chrome's tracing, as Electron's contentTracing offers it. */
export interface Tracing {
  start(config: object): Promise<void>;
  /** Writes the trace to `path`. */
  stop(path: string): Promise<string>;
}

export interface RecordingDeps {
  /** Where the zip goes, beside the draft. */
  dir: string;
  tracing: Tracing;
  metrics(): ProcessReading[];
  power: PowerReadings;
  /** Anonymizes paths and names, as the report's log is. */
  anonymize(text: string): string;
  /** The performance log as it stands, to go in the zip too. */
  log(): Promise<string>;
}

// What DevTools' Performance panel shows, JavaScript samples included, but
// not the compositor's and GPU's own steps, "toplevel", which repeats every
// task the timeline already has, or the stack of whatever set each timer or
// layout off, ~4 KB an event. Those were most of a trace.
const traceConfig = {
  recording_mode: "record-continuously",
  // A minute of a thread streaming on screen just fits and zips to ~11 MB.
  // A busier minute keeps its end, where the user reproduced the slowness.
  trace_buffer_size_in_kb: 100_000,
  included_categories: [
    "devtools.timeline",
    "disabled-by-default-devtools.timeline",
    "disabled-by-default-devtools.timeline.frame",
    "disabled-by-default-v8.cpu_profiler",
    "v8.execute",
    "blink.user_timing",
  ],
};

/** Images the window loaded, data URLs and all: the thread's own pictures. */
export const withoutImages = (trace: string) =>
  trace.replace(/"data:(?:[^"\\]|\\.){64,}"/g, '"data:(left out)"');

/**
 * Records Relay for `seconds` or until `signal` stops it: a Chrome trace of
 * every Relay process with the window's JavaScript sampled, the main
 * process's JavaScript profile, a reading of each process every second, and
 * the machine before and after. Zipped, anonymized, kept beside the draft.
 */
export async function recordPerformance(
  deps: RecordingDeps,
  { seconds, others }: { seconds: number; others: boolean },
  signal: AbortSignal,
) {
  const at = Date.now();
  const look = async () => {
    const s = await fullSnapshot(deps.power, () =>
      deps.metrics().map((m) => m.pid),
    );
    // The user took the other programs out of the report.
    if (!others) delete s.others;
    return s;
  };
  const before = await look();
  const tracePath = join(deps.dir, "trace.tmp.json");
  await mkdir(deps.dir, { recursive: true, mode: 0o700 });
  await deps.tracing.start(traceConfig);
  let profiler;
  try {
    profiler = await startMainProfile();
  } catch (error) {
    await deps.tracing.stop(tracePath).catch(() => {});
    await rm(tracePath, { force: true });
    throw error;
  }
  const readings: PerfSample[] = [];
  const machine = new MachineCpu();
  deps.metrics();
  const tick = setInterval(() => {
    void quickSnapshot(machine, deps.power).then(({ at: t, ...s }) =>
      readings.push({ t, p: byKind(deps.metrics()), s }),
    );
  }, 1000);
  try {
    await new Promise<void>((done) => {
      const timer = setTimeout(done, seconds * 1000);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        done();
      });
    });
  } finally {
    clearInterval(tick);
  }
  const ended = Date.now();
  const mainProfile = await profiler.stop().catch((e: unknown) => {
    console.warn("Could not stop the main process profile:", e);
    return null;
  });
  await deps.tracing.stop(tracePath);
  const after = await look();
  const trace = await readFile(tracePath, "utf8");
  await rm(tracePath, { force: true });

  const files: Zippable = {
    "README.txt": strToU8(readme(before, after, at, ended)),
    "trace.json": strToU8(deps.anonymize(withoutImages(trace))),
    "readings.json": strToU8(
      JSON.stringify({ before, after, everySecond: readings }, null, 1),
    ),
    "performance-log.txt": strToU8(await deps.log()),
  };
  if (mainProfile)
    files["main-process.cpuprofile"] = strToU8(
      deps.anonymize(JSON.stringify(mainProfile)),
    );
  const zipped = await new Promise<Uint8Array>((ok, fail) =>
    zip(files, { level: 6 }, (error, data) => (error ? fail(error) : ok(data))),
  );
  if (zipped.byteLength > recordingLimit)
    throw new Error(
      `The recording came out at ${Math.round(zipped.byteLength / 1e6)} MB, past GitHub's 25 MB. Record for a shorter time.`,
    );
  await writeFile(join(deps.dir, recordingFile), zipped, { mode: 0o600 });
  return {
    at,
    seconds: Math.round((ended - at) / 1000),
    bytes: zipped.byteLength,
  };
}

/** The main process's own JavaScript, which the trace doesn't sample. */
async function startMainProfile() {
  const session = new Session();
  session.connect();
  const post = (method: string, params?: object) =>
    new Promise<unknown>((ok, fail) =>
      session.post(method, params, (error, result) =>
        error ? fail(error) : ok(result),
      ),
    );
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 1000 });
  await post("Profiler.start");
  return {
    stop: async () => {
      try {
        const { profile } = (await post("Profiler.stop")) as {
          profile: unknown;
        };
        return profile;
      } finally {
        session.disconnect();
      }
    },
  };
}

function readme(
  before: SystemSnapshot,
  after: SystemSnapshot,
  from: number,
  to: number,
) {
  const others = (s: SystemSnapshot) =>
    s.others?.length
      ? s.others.map((o) => `${o.name} ${o.cpu}%`).join(", ")
      : "none busy, or unknown";
  return `Relay performance recording
${new Date(from).toISOString()} to ${new Date(to).toISOString()}

trace.json               Chrome trace of Relay's processes. Open it in Chrome
                         DevTools > Performance > Load profile, or at
                         https://ui.perfetto.dev
main-process.cpuprofile  The main process's JavaScript. DevTools >
                         Performance > Load profile opens it too.
readings.json            Each Relay process's CPU and memory every second, and
                         the machine before and after.
performance-log.txt      The last day of Relay's load, every 30 seconds.

Paths and names on the recording computer are replaced with placeholders.

The machine before: ${machineText(before)}
Busiest other programs before: ${others(before)}
The machine after: ${machineText(after)}
Busiest other programs after: ${others(after)}
`;
}
