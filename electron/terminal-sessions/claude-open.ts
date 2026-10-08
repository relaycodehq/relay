// Which Claude Code sessions a running terminal holds. Each interactive
// `claude` process lists itself in `<home>/sessions/<pid>.json` while it runs;
// an entry left behind by a crash names a pid that is gone, or one since
// reused by another process, which a different start time gives away.
import { execFile } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Running pids, each with its start time as `ps -o lstart` gives it, when known. */
export type RunningSince = (
  pids: number[],
) => Promise<Map<number, string | undefined>>;

type Entry = { pid: number; sessionId: string; procStart?: string };

const spaced = (text: string) => text.trim().replace(/\s+/g, " ");

/** The start time Claude Code records is `ps`'s, read in UTC with C locale. */
export const runningSince: RunningSince = async (pids) => {
  const out = new Map<number, string | undefined>();
  if (!pids.length) return out;
  if (process.platform !== "win32") {
    try {
      const { stdout } = await run(
        "ps",
        ["-o", "pid=,lstart=", "-p", pids.join(",")],
        {
          env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
        },
      );
      for (const line of stdout.split("\n")) {
        const match = /^\s*(\d+)\s+(.+)$/.exec(line);
        if (match) out.set(Number(match[1]), spaced(match[2]!));
      }
      return out;
    } catch (e) {
      // ps exits 1 when none of the pids run.
      if ((e as { code?: unknown }).code === 1) return out;
    }
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      out.set(pid, undefined);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EPERM")
        out.set(pid, undefined);
    }
  }
  return out;
};

async function entries(dir: string) {
  const names = await readdir(dir).catch(() => [] as string[]);
  const read = await Promise.all(
    // Only the session lists; the folder holds other things too.
    names
      .filter((name) => /^\d+\.json$/.test(name))
      .map(async (name) => {
        try {
          const entry = JSON.parse(await readFile(join(dir, name), "utf8"));
          if (!Number.isSafeInteger(entry?.pid) || entry.pid <= 0) return;
          if (typeof entry.sessionId !== "string") return;
          return {
            pid: entry.pid,
            sessionId: entry.sessionId,
            ...(typeof entry.procStart === "string"
              ? { procStart: entry.procStart }
              : {}),
          } satisfies Entry;
        } catch {
          return undefined;
        }
      }),
  );
  return read.filter((entry): entry is Entry => !!entry);
}

/** Ids of the sessions a running `claude` process lists as its own, across `homes`. */
export async function claudeOpen(
  homes: string[],
  since: RunningSince = runningSince,
) {
  const dirs = new Set<string>();
  for (const home of homes) {
    const dir = await realpath(join(home, "sessions")).catch(() => undefined);
    if (dir) dirs.add(dir);
  }
  const listed = (await Promise.all([...dirs].map(entries))).flat();
  const running = await since([...new Set(listed.map((e) => e.pid))]);
  return new Set(
    listed
      .filter(({ pid, procStart }) => {
        if (!running.has(pid)) return false;
        const started = running.get(pid);
        return !procStart || !started || spaced(procStart) === started;
      })
      .map((e) => e.sessionId),
  );
}
