import {
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Crashed runs whose log is kept, newest first; each at most this much. */
const keep = 3;
export const crashLogLimit = 2 << 20;
const name = (startedAt: number) => `crashed-run-${startedAt}.log`;
const pattern = /^crashed-run-(\d+)\.log$/;
/** The line startLog's caller writes as a run begins. */
const runStart = /^\S+ info Relay \S+ started$/gm;

/**
 * Copies the log of a run that ended without quitting out of the way of
 * rotation, so this run's logging can't push it out before it's reported.
 * Called at launch, once this run's first line is written: everything before
 * that line is the crashed run and what came before it.
 */
export function keepCrashedRunLog(logs: string, startedAt: number) {
  const read = (file: string) => {
    try {
      return readFileSync(join(logs, file), "utf8");
    } catch {
      return "";
    }
  };
  let text = read("main.old.log") + read("main.log");
  const starts = [...text.matchAll(runStart)];
  const current = starts.at(-1);
  if (current) text = text.slice(0, current.index);
  text = tail(text, crashLogLimit);
  if (!text.trim()) return null;
  try {
    const tmp = join(logs, `${name(startedAt)}.tmp`);
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, join(logs, name(startedAt)));
    for (const old of keptRuns(logs).slice(keep))
      rmSync(join(logs, name(old)), { force: true });
    return join(logs, name(startedAt));
  } catch (error) {
    console.warn("Could not keep the crashed run's log:", error);
    return null;
  }
}

/** The kept log of the run that started at `startedAt`, if there is one. */
export function crashedRunLog(logs: string, startedAt: number) {
  try {
    return readFileSync(join(logs, name(startedAt)), "utf8");
  } catch {
    return null;
  }
}

/** Start times of the kept crashed runs, newest first. */
function keptRuns(logs: string) {
  return readdirSync(logs)
    .map((file) => Number(pattern.exec(file)?.[1]))
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
}

/** The last `limit` characters, from the start of a line. */
function tail(text: string, limit: number) {
  if (text.length <= limit) return text;
  const cut = text.slice(text.length - limit);
  const line = cut.indexOf("\n");
  return line < 0 ? cut : cut.slice(line + 1);
}
