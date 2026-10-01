import { readFile, rename, writeFile } from "node:fs/promises";

/** Filter cache key → last use and question hash → yes-probability. */
export interface RelevanceAnswers {
  [key: string]: { at: number; answers: Record<string, number> };
}

/** Filter answers for projects or hints unused this long are dropped. */
const ttl = 30 * 24 * 60 * 60_000;

/** The filter's answers, kept in `file` so they outlive restarts. */
export class RelevanceCache {
  private loaded?: Promise<RelevanceAnswers>;
  private saving = Promise.resolve();

  constructor(private file?: string) {}

  /** Read once; every caller shares and edits the same answers. */
  load() {
    return (this.loaded ??= (async () => {
      if (!this.file) return {};
      try {
        const saved = JSON.parse(await readFile(this.file, "utf8"));
        return saved?.version === 1 && saved.keys ? saved.keys : {};
      } catch {
        // A missing or damaged cache only costs a few questions.
        return {};
      }
    })());
  }

  save(cache: RelevanceAnswers) {
    for (const [key, entry] of Object.entries(cache))
      if (Date.now() - entry.at > ttl) delete cache[key];
    const file = this.file;
    if (!file) return;
    const text = JSON.stringify({ version: 1, keys: cache });
    // Writes queue up so runs for different projects never share the temp file.
    return (this.saving = this.saving.then(async () => {
      try {
        await writeFile(`${file}.tmp`, text, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      } catch {
        // The answers stay cached in memory for this session.
      }
    }));
  }
}
