import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { app, contentTracing, powerMonitor } from "electron";
import { logFiles, PerfLog, type ProcessReading } from "./perf-log";
import { recordPerformance } from "./recording";
import { fullSnapshot, type PowerReadings } from "./snapshot";

export { performanceFacts } from "./summary";
export { recordingFile, recordingLimit } from "./recording";
export type { PerfSample } from "./perf-log";
export type { SystemSnapshot } from "./snapshot";

const power: PowerReadings = {
  onBattery: () => powerMonitor.isOnBatteryPower(),
  // macOS only; elsewhere it throws or says "unknown", and is left out.
  thermalState: () => powerMonitor.getCurrentThermalState(),
};

function metrics(): ProcessReading[] {
  // Electron spreads the share over every core; the log counts one core's
  // worth, as `ps` and Activity Monitor do.
  const cores = cpus().length || 1;
  return app.getAppMetrics().map((m) => ({
    pid: m.pid,
    type: m.type,
    cpu: m.cpu.percentCPUUsage * cores,
    mb: m.memory.workingSetSize / 1024,
  }));
}

/**
 * Starts Relay's performance log and hands out what a problem report reads:
 * the log, the machine now, and recordings.
 */
export function setUpPerformance() {
  const dir = app.getPath("logs");
  const log = new PerfLog({ dir, metrics, power });
  void app.whenReady().then(() => log.start());
  const logText = async () =>
    (
      await Promise.all(
        logFiles.map((f) => readFile(join(dir, f), "utf8").catch(() => "")),
      )
    ).join("");
  return {
    samples: () => log.read(),
    /** The machine now, the busiest other programs included. */
    snapshot: () => fullSnapshot(power, () => metrics().map((m) => m.pid)),
    /** The log's lines, oldest first, as a file for the report. */
    logText,
    record: (
      recordDir: string,
      anonymize: (text: string) => string,
      options: { seconds: number; others: boolean },
      signal: AbortSignal,
    ) =>
      recordPerformance(
        {
          dir: recordDir,
          tracing: {
            start: (config) => contentTracing.startRecording(config),
            stop: (path) => contentTracing.stopRecording(path),
          },
          metrics,
          power,
          anonymize,
          log: logText,
        },
        options,
        signal,
      ),
  };
}

export type Performance = ReturnType<typeof setUpPerformance>;
