import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";

/** A run that ended without quitting: a crash, a force quit or a hang. */
export interface LastRun {
  version: string;
  startedAt: number;
  /** Runs in a row that ended this way, this one included. */
  crashes: number;
  /**
   * Of those, the latest in a row that ended while starting, before `started`:
   * a crash at startup, which happening again is a crash loop.
   */
  early: number;
  /** Crashpad wrote a minidump during it, so the process itself crashed. */
  dump: boolean;
}

/**
 * Leaves a marker for as long as Relay runs; a quit removes it, so finding
 * one at launch means the last run never got to quit. A run the computer
 * restarted under doesn't count unless it left a dump: shutting down kills
 * Relay without a quit on Linux, where the compositor goes first. `started`
 * marks the run as through its startup.
 */
export function trackRun(
  dir: string,
  version: string,
  dumps: string,
  now = Date.now(),
  bootedAt = now - uptime() * 1000,
) {
  const file = join(dir, "running.json");
  let last: LastRun | null = null;
  try {
    const marker = JSON.parse(readFileSync(file, "utf8"));
    if (typeof marker.startedAt === "number") {
      const dump = dumpSince(dumps, marker.startedAt);
      if (dump || marker.startedAt >= bootedAt)
        last = {
          version: String(marker.version),
          startedAt: marker.startedAt,
          crashes: (Number(marker.crashes) || 0) + 1,
          early: marker.started ? 0 : (Number(marker.early) || 0) + 1,
          dump,
        };
    }
  } catch {
    // No marker: the last run quit, or there wasn't one.
  }
  const marker = {
    version,
    startedAt: now,
    crashes: last?.crashes ?? 0,
    early: last?.early ?? 0,
  };
  let quit = false;
  const write = (started: boolean) => {
    // A quit's shutdown can outlast the startup timer.
    if (quit) return;
    try {
      writeFileSync(file, JSON.stringify({ ...marker, started }));
    } catch (error) {
      console.warn("Could not mark this run as started:", error);
    }
  };
  write(false);
  return {
    last,
    started: () => write(true),
    quit: () => {
      quit = true;
      rmSync(file, { force: true });
    },
  };
}

function dumpSince(dir: string, since: number) {
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" }).some(
      (name) =>
        name.endsWith(".dmp") && statSync(join(dir, name)).mtimeMs >= since,
    );
  } catch {
    return false;
  }
}
