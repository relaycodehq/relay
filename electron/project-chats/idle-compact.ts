import type { ChatSummary, ProjectChat } from "../../shared/projects";
import { chatSettled } from "../../shared/chat-activity";
import { defaultAutoCompact, idleCompactAt } from "../../shared/context-usage";
import { worktreeExists } from "../git/worktrees";
import type { ChatCore } from "./core";
import { agentSession } from "./sessions";

/** Long enough after the newest cache's lifetime that a thread can't still be due. */
const LOOK_BACK = 2 * 3_600_000;

export interface IdleCompactHost {
  /** The thread as the sidebar lists it, settled by itself included. */
  summary(chat: ProjectChat): ChatSummary | undefined;
  /** A deep review's lead waiting on its reviewers. */
  busy(chat: ProjectChat): boolean;
  /** Compacts the main conversation, from a job holding the thread's control. */
  compact(id: string): Promise<void>;
}

/**
 * Whether you are likely to come back to it: you haven't settled it, read or
 * not. A thread another thread's agent started is its lead's, so only once you
 * pinned or snoozed it.
 */
function comingBack(c: ChatSummary) {
  const snoozed = c.snoozedUntil != null && (c.seenAt ?? 0) < c.snoozedUntil;
  return !c.startedBy || snoozed || !!c.pinnedAt;
}

/**
 * Compacts a big conversation left idle a few minutes before its prompt
 * cache expires, while the compaction still reads the context cheaply; a
 * message after that only carries the summary. Only threads you haven't
 * settled: a settled one still compacts when a message finds it cold.
 */
export class IdleCompactions {
  private timers = new Map<string, NodeJS.Timeout>();
  /** The newest arm() per thread: an older one's load can finish after it. */
  private arming = new Map<string, symbol>();
  private stopped = false;
  constructor(
    private core: ChatCore,
    private host: IdleCompactHost,
  ) {}

  /** After launch: threads whose cache may still be warm. */
  armAll() {
    this.stopped = false;
    const since = Date.now() - LOOK_BACK;
    for (const c of this.core.store.get().chats ?? [])
      if (c.updated >= since) void this.arm(c.id);
  }

  stop() {
    this.stopped = true;
    this.arming.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** A run in the thread ended: plans its compaction from the newest context. */
  async arm(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (this.stopped || this.core.closing()) return;
    const mine = Symbol();
    this.arming.set(id, mine);
    const chat = await this.core.storage.load(id).catch(() => undefined);
    if (this.arming.get(id) !== mine) return;
    this.arming.delete(id);
    if (!chat || this.stopped || !this.on()) return;
    const at = idleCompactAt(main(chat), Date.now());
    if (at !== undefined) this.schedule(id, at);
  }

  private on() {
    return (this.core.store.get().autoCompact ?? defaultAutoCompact).idle;
  }

  private schedule(id: string, at: number) {
    this.timers.set(
      id,
      setTimeout(
        () =>
          void this.fire(id).catch((e) =>
            console.warn("Could not compact the idle conversation:", e),
          ),
        Math.max(at - Date.now(), 0),
      ),
    );
  }

  private async fire(id: string) {
    this.timers.delete(id);
    // Turned off in Settings since it was planned.
    if (this.core.closing() || !this.on()) return;
    await this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      // A sleep that outlasted the cache, or a turn since, changed what's due.
      const at = idleCompactAt(main(chat), Date.now());
      if (at === undefined) return;
      // Early: a timer can fire a millisecond short, or the clock stepped back.
      if (at > Date.now()) {
        if (!this.stopped && !this.timers.has(id) && !this.arming.has(id))
          this.schedule(id, at);
        return;
      }
      const listed = this.host.summary(chat);
      const provider = main(chat)
        .filter((m) => m.role === "assistant")
        .at(-1)?.provider;
      if (
        !listed ||
        !provider ||
        this.core.active.has(id) ||
        this.host.busy(chat) ||
        chat.queue?.length ||
        chat.queuePaused ||
        chat.archivedAt ||
        chat.sentTo ||
        chat.reviewer ||
        listed.running ||
        listed.waiting ||
        listed.asking ||
        listed.pending?.length ||
        // Its account is still out of usage until the limit lifts.
        listed.limitResume ||
        chatSettled(listed) ||
        !comingBack(listed) ||
        !agentSession(chat, provider).thread
      )
        return;
      // Finding the thread's folder would recreate a deleted worktree.
      if (chat.worktree && !(await worktreeExists(chat.worktree))) return;
      await this.host.compact(id);
    });
  }
}

const main = (chat: ProjectChat) => chat.messages.filter((m) => !m.parentId);
