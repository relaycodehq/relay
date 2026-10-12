// The subagents a thread's agents ran, kept on disk beside the thread: the
// sessions that followed them end on a restart or after sitting idle, and the
// indicator's fan-outs and each agent's side thread shouldn't go with them.
// Read only when asked for, so a thread's long runs never slow its loading.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SubagentDetail } from "../../shared/subagents";
import { keyedQueue } from "../util/keyed-queue";

type Saved = {
  /** When the runs were last seen live; one still running then ended by it. */
  saved: number;
  runs: SubagentDetail[];
};

const limits = { runs: 40, trace: 200, detail: 2_000 };

/** A run as it's kept: the start of its trace dropped past the limit, long output cut. */
function trimmed(run: SubagentDetail): SubagentDetail {
  return {
    ...run,
    trace: run.trace.slice(-limits.trace).map((entry) =>
      entry.kind === "activity" &&
      (entry.activity.detail?.length ?? 0) > limits.detail
        ? {
            ...entry,
            activity: {
              ...entry.activity,
              detail: entry.activity.detail!.slice(-limits.detail),
            },
          }
        : entry,
    ),
  };
}

export class SubagentArchive {
  private cache = new Map<string, Saved>();
  private writes = keyedQueue();
  constructor(
    private dir: string,
    private now = () => Date.now(),
  ) {}

  /** What was kept of the thread's runs; one left running stopped when last seen. */
  async read(chatId: string): Promise<SubagentDetail[]> {
    const { saved, runs } = await this.load(chatId);
    return runs.map((run) =>
      run.status === "running"
        ? { ...run, status: "stopped", ended: saved, summary: undefined }
        : run,
    );
  }

  /** Keeps the runs the thread's sessions know now, over what was kept of them before. */
  keep(chatId: string, live: SubagentDetail[]) {
    if (!live.length) return Promise.resolve();
    return this.writes(chatId, async () => {
      const before = await this.load(chatId);
      const runs = new Map(before.runs.map((run) => [run.id, run]));
      for (const run of live) runs.set(run.id, trimmed(run));
      const next: Saved = {
        saved: this.now(),
        runs: [...runs.values()]
          .sort((a, b) => a.started - b.started)
          .slice(-limits.runs),
      };
      if (JSON.stringify(next.runs) === JSON.stringify(before.runs)) {
        before.saved = next.saved;
        return;
      }
      this.cache.set(chatId, next);
      await mkdir(join(this.dir, "subagents"), {
        recursive: true,
        mode: 0o700,
      });
      const path = this.path(chatId);
      const tmp = `${path}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
      await rename(tmp, path);
    });
  }

  forget(chatId: string) {
    return this.writes(chatId, async () => {
      this.cache.delete(chatId);
      await rm(this.path(chatId), { force: true });
    });
  }

  /** Writes still under way, for quitting. */
  pending() {
    return this.writes.pending();
  }

  private path(chatId: string) {
    return join(this.dir, "subagents", `${chatId}.json`);
  }

  private async load(chatId: string): Promise<Saved> {
    const cached = this.cache.get(chatId);
    if (cached) return cached;
    let saved: Saved = { saved: 0, runs: [] };
    try {
      const value = JSON.parse(await readFile(this.path(chatId), "utf8"));
      if (Array.isArray(value?.runs))
        saved = {
          saved: typeof value.saved === "number" ? value.saved : 0,
          runs: value.runs,
        };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("Could not read a thread's kept subagents:", error);
    }
    this.cache.set(chatId, saved);
    return saved;
  }
}
