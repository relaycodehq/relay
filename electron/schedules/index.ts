// Prompts Relay sends on its own on a schedule (shared/schedules). They live
// in this computer's state and run while Relay runs here, the desktop or the
// headless one alike: each due time starts a run (./runs), followed until its
// answer ends, and stopped once it uses more than its token limit.
import { randomUUID } from "node:crypto";
import { errorMessage } from "../../shared/error-message";
import type { ProjectChat } from "../../shared/projects";
import {
  dueBetween,
  nextRun,
  RUNS_KEPT,
  scheduleInputSchema,
  SCRATCHPAD_SCHEDULE,
  type Schedule,
  type ScheduleInput,
  type ScheduleRun,
} from "../../shared/schedules";
import type { Store } from "../app/store";
import {
  answerTo,
  ended,
  startRun,
  tokensOf,
  type RunChats,
  type RunProjects,
} from "./runs";

export { summaryOf } from "./runs";
export type { RunChats, RunProjects } from "./runs";

/** How often a run still going is looked at, for its token limit. */
const WATCH_MS = 20_000;
/** A timer waits at most about 24.8 days; a later run re-arms when it fires. */
const LONGEST_TIMER = 2 ** 31 - 1;

export interface ScheduleHost {
  chats: RunChats & {
    /** Hears each thread saved as its turn ends. */
    onSaved(listener: (chat: ProjectChat) => void): () => void;
    cancel(id: string): Promise<unknown>;
  };
  projects: RunProjects;
  /** Tells the windows the schedules changed. */
  changed(schedules: Schedule[]): void;
}

const sameWhen = (a: ScheduleInput, b: ScheduleInput) =>
  a.repeat === b.repeat &&
  a.time === b.time &&
  a.monthDay === b.monthDay &&
  a.days.join() === b.days.join();

export class Schedules {
  private timers = new Map<string, NodeJS.Timeout>();
  private watcher: NodeJS.Timeout | undefined;
  /** Runs Relay stopped for using more than their limit. */
  private overLimit = new Set<string>();
  private closed = false;

  constructor(
    private store: Store,
    private host: ScheduleHost,
  ) {
    host.chats.onSaved((chat) => void this.follow(chat.id));
  }

  list(): Schedule[] {
    return structuredClone(this.store.get().schedules ?? []);
  }

  projectName(id: string) {
    return this.host.projects.name(id);
  }

  private find(id: string) {
    const schedule = this.list().find((s) => s.id === id);
    if (!schedule) throw new Error("There's no such schedule.");
    return schedule;
  }

  /** Makes a schedule without `id`, changes the one with it; `setUpIn` names an agent's thread. */
  async save(id: string | null, raw: ScheduleInput, setUpIn?: Schedule["setUpIn"]) {
    const input = scheduleInputSchema.parse(raw);
    if (input.enabled && !input.prompt.trim())
      throw new Error("Write what it should do before turning it on.");
    if (input.projectId !== SCRATCHPAD_SCHEDULE && !this.host.projects.has(input.projectId))
      throw new Error("That project isn't in Relay.");
    if (id) this.find(id);
    const now = Date.now();
    let saved: Schedule | undefined;
    await this.update((list) => {
      const old = id ? list.find((s) => s.id === id) : undefined;
      // Deleted meanwhile: nothing to change.
      if (id && !old) return;
      saved = old
        ? {
            ...old,
            ...input,
            // A new time, or turning it back on, owes nothing from before.
            handledUntil:
              !sameWhen(old, input) || (input.enabled && !old.enabled) ? now : old.handledUntil,
            ...(setUpIn && !old.setUpIn ? { setUpIn } : {}),
          }
        : { ...input, id: randomUUID(), created: now, handledUntil: now, runs: [], ...(setUpIn ? { setUpIn } : {}) };
      if (old) list.splice(list.indexOf(old), 1, saved);
      else list.unshift(saved);
    });
    if (!saved) throw new Error("There's no such schedule.");
    this.arm(saved);
    return structuredClone(saved);
  }

  async remove(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    await this.update((list) => {
      const at = list.findIndex((s) => s.id === id);
      if (at >= 0) list.splice(at, 1);
    });
  }

  /** Runs it now, as a test, whether or not it's on; the thread it started. */
  async test(id: string) {
    const run = await this.run(this.find(id), true);
    if (run.outcome === "failed") throw new Error(run.summary);
    return run.chatId!;
  }

  /** At launch and on waking: catches up what came due meanwhile, picks up runs still going. */
  armAll() {
    if (this.closed) return;
    for (const schedule of this.list()) {
      this.arm(schedule);
      for (const run of schedule.runs)
        if (run.outcome === "running" && run.chatId) void this.follow(run.chatId);
    }
  }

  /** Relay is closing; what's due waits for the next launch. */
  stop() {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    clearInterval(this.watcher);
  }

  private arm(schedule: Schedule) {
    clearTimeout(this.timers.get(schedule.id));
    this.timers.delete(schedule.id);
    if (!schedule.enabled || this.closed) return;
    const at = nextRun(schedule, schedule.handledUntil);
    const delay = Math.min(Math.max(at - Date.now(), 0), LONGEST_TIMER);
    this.timers.set(
      schedule.id,
      setTimeout(() => {
        this.timers.delete(schedule.id);
        void this.due(schedule.id).catch((e) => console.warn("Could not run a schedule:", e));
      }, delay),
    );
  }

  /**
   * Runs what's due. One missed time, as after a night asleep, still runs;
   * several mean Relay was closed for days, and those are skipped. A run still
   * going makes the next one skip, as it would only trip over it.
   */
  private async due(id: string) {
    const schedule = this.list().find((s) => s.id === id);
    if (!schedule?.enabled || this.closed) return;
    const now = Date.now();
    const owed = dueBetween(schedule, schedule.handledUntil, now);
    if (!owed.length) return this.arm(schedule);
    await this.update((list) => {
      const s = list.find((x) => x.id === id);
      if (s) s.handledUntil = now;
    });
    const last = schedule.runs.find((r) => !r.test);
    if (owed.length > 1)
      await this.record(id, {
        id: randomUUID(),
        at: now,
        outcome: "skipped",
        summary: `Didn't run ${owed.length} times while Relay was closed`,
      });
    else if (last?.outcome === "running" && last.chatId && (await this.host.chats.busy(last.chatId)))
      await this.record(id, {
        id: randomUUID(),
        at: now,
        outcome: "skipped",
        summary: "The last run was still going",
      });
    else await this.run(schedule, false);
    const fresh = this.list().find((s) => s.id === id);
    if (fresh) this.arm(fresh);
  }

  private async run(schedule: Schedule, test: boolean): Promise<ScheduleRun> {
    const base = { id: randomUUID(), at: Date.now(), ...(test ? { test: true as const } : {}) };
    try {
      const started = await startRun(schedule, test, this.host.chats, this.host.projects);
      const run: ScheduleRun = { ...base, outcome: "running", ...started };
      await this.record(schedule.id, run, started.chatId);
      this.watch();
      return run;
    } catch (e) {
      const run: ScheduleRun = { ...base, outcome: "failed", summary: errorMessage(e) };
      await this.record(schedule.id, run);
      return run;
    }
  }

  /** Looks at the runs going in `chatId`: records the ones that ended, stops one over its limit. */
  private async follow(chatId: string) {
    for (const schedule of this.list())
      for (const run of schedule.runs) {
        if (run.outcome !== "running" || run.chatId !== chatId || !run.messageId) continue;
        const chat = await this.host.chats.get(chatId).catch(() => undefined);
        if (!chat) {
          await this.finish(schedule.id, run.id, { outcome: "failed", summary: "Its thread is gone" });
          continue;
        }
        const answer = answerTo(chat, run.messageId);
        const result = ended(answer, this.overLimit.has(run.id));
        if (result) {
          this.overLimit.delete(run.id);
          await this.finish(schedule.id, run.id, result);
        } else if (
          schedule.tokenLimit &&
          (tokensOf(answer) ?? 0) > schedule.tokenLimit &&
          !this.overLimit.has(run.id)
        ) {
          this.overLimit.add(run.id);
          await this.host.chats.cancel(chatId).catch((e) => console.warn("Could not stop a scheduled run:", e));
        }
      }
  }

  /** Looks at runs still going now and then, until none is. */
  private watch() {
    if (this.watcher) return;
    this.watcher = setInterval(() => {
      const going = this.list().flatMap((s) =>
        s.runs.filter((r) => r.outcome === "running" && r.chatId).map((r) => r.chatId!),
      );
      if (!going.length) {
        clearInterval(this.watcher);
        this.watcher = undefined;
        return;
      }
      for (const chatId of new Set(going)) void this.follow(chatId);
    }, WATCH_MS);
    this.watcher.unref?.();
  }

  private finish(id: string, runId: string, result: Pick<ScheduleRun, "outcome" | "summary" | "tokens">) {
    return this.update((list) => {
      const run = list.find((s) => s.id === id)?.runs.find((r) => r.id === runId);
      if (run) Object.assign(run, result);
    });
  }

  private record(id: string, run: ScheduleRun, chatId?: string) {
    return this.update((list) => {
      const s = list.find((x) => x.id === id);
      if (!s) return;
      s.runs = [run, ...s.runs].slice(0, RUNS_KEPT);
      if (chatId && !run.test) s.lastChatId = chatId;
    });
  }

  private async update(change: (list: Schedule[]) => void) {
    await this.store.update((state) => change((state.schedules ??= [])));
    this.host.changed(this.list());
  }
}
