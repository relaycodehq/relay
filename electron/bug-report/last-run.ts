import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** A run that ended without quitting: a crash, a force quit or a hang. */
export interface LastRun {
  version: string;
  startedAt: number;
  /** Runs in a row that ended this way, this one included. */
  crashes: number;
  /** Crashpad wrote a minidump during it, so the process itself crashed. */
  dump: boolean;
}

/**
 * Leaves a marker for as long as Relay runs; a quit removes it, so finding
 * one at launch means the last run never got to quit.
 */
export function trackRun(
  dir: string,
  version: string,
  dumps: string,
  now = Date.now(),
) {
  const file = join(dir, "running.json");
  let last: LastRun | null = null;
  try {
    const marker = JSON.parse(readFileSync(file, "utf8"));
    if (typeof marker.startedAt === "number")
      last = {
        version: String(marker.version),
        startedAt: marker.startedAt,
        crashes: (Number(marker.crashes) || 0) + 1,
        dump: dumpSince(dumps, marker.startedAt),
      };
  } catch {
    // No marker: the last run quit, or there wasn't one.
  }
  try {
    writeFileSync(
      file,
      JSON.stringify({ version, startedAt: now, crashes: last?.crashes ?? 0 }),
    );
  } catch (error) {
    console.warn("Could not mark this run as started:", error);
  }
  return {
    last,
    quit: () => rmSync(file, { force: true }),
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
