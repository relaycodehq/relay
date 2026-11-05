import { randomUUID } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  BugReportDraft,
  BugReportOccasion,
} from "../../shared/bug-report";
import { writeFileAtomic } from "../util/atomic-write";
import { recordingName } from "./report";

/**
 * The report being written, kept in `dir` as `draft.json` with its
 * screenshots and recording beside it. Changes run one at a time.
 */
export class DraftStore {
  private draft?: Promise<BugReportDraft>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private dir: string,
    private now: () => number,
  ) {}

  private get file() {
    return join(this.dir, "draft.json");
  }

  shot(id: string) {
    return join(this.dir, "screenshots", `${id}.png`);
  }

  get recordingPath() {
    return join(this.dir, recordingName);
  }

  /** Runs one change at a time, each on the draft as the last left it. */
  change(fn: (draft: BugReportDraft) => Promise<void> | void) {
    const task = this.queue.then(async () => {
      const draft = structuredClone(await this.load());
      await fn(draft);
      draft.updatedAt = this.now();
      await this.write(draft);
      this.draft = Promise.resolve(draft);
      return draft;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  load() {
    this.draft ??= this.read();
    return this.draft;
  }

  private async read(): Promise<BugReportDraft> {
    try {
      const saved = JSON.parse(
        await readFile(this.file, "utf8"),
      ) as BugReportDraft;
      if (typeof saved.id !== "string") throw new Error("Not a draft");
      saved.kind = saved.kind === "feature" ? "feature" : "bug";
      saved.description ??= "";
      // A screenshot whose file is gone can't be shown or sent.
      const present = new Set(
        await readdir(join(this.dir, "screenshots")).catch(() => []),
      );
      saved.screenshots = (saved.screenshots ?? []).filter((s) =>
        present.has(`${s.id}.png`),
      );
      if (saved.recording && !(await exists(this.recordingPath)))
        delete saved.recording;
      return saved;
    } catch {
      return this.fresh({ kind: "asked" });
    }
  }

  fresh(occasion: BugReportOccasion): BugReportDraft {
    return {
      id: randomUUID(),
      kind: "bug",
      title: "",
      description: "",
      occasion,
      includeLog: true,
      removedFacts: [],
      screenshots: [],
      updatedAt: this.now(),
    };
  }

  private async write(draft: BugReportDraft) {
    await writeFileAtomic(this.file, JSON.stringify(draft), { mkdir: 0o700 });
  }

  /**
   * Removes the folder and starts a blank draft; `cleared` runs before any
   * change queued after this one.
   */
  async discard(cleared: () => void) {
    // Reserve our place before awaiting filesystem work. A later save must
    // resolve against the replacement draft, not write beside this removal.
    const task = this.queue.then(async () => {
      await rm(this.dir, { recursive: true, force: true });
      this.draft = Promise.resolve(this.fresh({ kind: "asked" }));
      cleared();
    });
    this.queue = task.catch(() => {});
    await task;
  }
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
