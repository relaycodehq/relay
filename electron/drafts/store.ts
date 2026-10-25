import { readFile } from "node:fs/promises";
import {
  applyDraftWrite,
  dropOtherDraft,
  sharedDraftSchema,
  swapOtherDraft,
  writeBase,
  type DraftChange,
  type DraftDevice,
  type DraftWrite,
  type SharedDraft,
} from "../../shared/drafts";
import { writeFileAtomic } from "../util/atomic-write";

/**
 * A write from a version it missed, for telling a lost answer from a real
 * clash when a draft comes back. Lengths only: the log goes into reports.
 */
function logMissedBase(
  current: SharedDraft | undefined,
  write: DraftWrite,
  by: DraftDevice,
  after: SharedDraft | null,
) {
  const base = writeBase(current, write, by);
  if (base === "current" || !current) return;
  const outcome = !after
    ? "gone"
    : after.text === current.text
      ? `kept ${after.text.length} chars`
      : `now ${after.text.length} chars`;
  console.info(
    `[drafts] ${base} write to ${write.key} by ${by}: base ${write.base}, ` +
      `current ${current.rev} by ${current.by}, written ${write.at - current.at}ms after it, ` +
      `${write.sent !== undefined ? `sent ${write.sent.length} chars` : `${write.text.length} chars`}, ` +
      `${outcome}${after?.other && after.other !== current.other ? ", clash kept the other" : ""}`,
  );
}

/** Written this long after the last change; a draft changes with every pause in typing. */
const saveMs = 300;

/**
 * The computer's drafts, in a file of their own beside state.json: they
 * change as often as anyone types, and state.json is rewritten whole.
 */
export class DraftStore {
  private drafts = new Map<string, SharedDraft>();
  private rev = 0;
  private timer?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();
  constructor(private file: string) {}

  async load() {
    let saved: unknown;
    try {
      saved = JSON.parse(await readFile(this.file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("Could not read the saved drafts:", e);
      return;
    }
    const { rev, drafts } = (saved ?? {}) as { rev?: unknown; drafts?: unknown };
    for (const value of Array.isArray(drafts) ? drafts : []) {
      // One that doesn't read is dropped; the rest stay.
      const draft = sharedDraftSchema.safeParse(value).data;
      if (draft) this.drafts.set(draft.key, draft);
    }
    this.rev = Math.max(
      Number.isInteger(rev) ? (rev as number) : 0,
      ...[...this.drafts.values()].map((d) => d.rev),
    );
  }

  list(): SharedDraft[] {
    return [...this.drafts.values()];
  }
  get(key: string) {
    return this.drafts.get(key);
  }

  write(write: DraftWrite, by: DraftDevice): DraftChange | undefined {
    const current = this.drafts.get(write.key);
    const { draft, changed } = applyDraftWrite(
      current,
      write,
      by,
      () => ++this.rev,
    );
    logMissedBase(current, write, by, draft);
    if (!changed) return;
    return this.set(write.key, draft, write.sent !== undefined);
  }

  /** Swaps in the version a clash kept, or with `drop` lets it go. */
  other(key: string, drop: boolean): DraftChange | undefined {
    const current = this.drafts.get(key);
    if (!current?.other) return;
    const rev = ++this.rev;
    return this.set(
      key,
      drop ? dropOtherDraft(current, rev) : swapOtherDraft(current, rev),
    );
  }

  /** Forgets drafts whose thread is gone. */
  remove(keys: Iterable<string>): DraftChange[] {
    const changes: DraftChange[] = [];
    for (const key of keys)
      if (this.drafts.has(key)) changes.push(this.set(key, null));
    return changes;
  }

  /** Writes what's waiting, for a quit. */
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.save();
    }
    await this.queue;
  }

  private set(key: string, draft: SharedDraft | null, sent = false) {
    if (draft) this.drafts.set(key, draft);
    else this.drafts.delete(key);
    this.later();
    return { key, draft, ...(sent && !draft ? { sent: true as const } : {}) };
  }

  private later() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.save();
    }, saveMs);
    this.timer.unref?.();
  }

  private save() {
    const json = JSON.stringify({ rev: this.rev, drafts: this.list() });
    this.queue = this.queue
      .then(async () => {
        await writeFileAtomic(this.file, json, { mkdir: 0o700 });
      })
      .catch((e) => console.warn("Could not save the drafts:", e));
  }
}
