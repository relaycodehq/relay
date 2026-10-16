import type { ProjectChat, ProjectChatSend } from "../../shared/projects";
import type { ActiveChat } from "./active";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import type { ChatQueue } from "./queue";

/** What every turn in a thread does when it ends, whichever flow ran it. */
export class RunEnds {
  constructor(
    private core: ChatCore,
    private councils: Councils,
    private queue: ChatQueue,
    /** A run ended and its queue went out; see ThreadTriage.ended. */
    private ended: (id: string) => Promise<void>,
  ) {}
  /**
   * Ends a run. The thread goes idle first: the finished answer moved
   * `updated`, and the sidebar summary only catches up once the thread no
   * longer counts as active. Queued messages go out last, after a deep review
   * has taken its next step, since that step decides whether the review
   * still holds them back.
   */
  run(
    chat: ProjectChat,
    active: ActiveChat,
    turn?: { request?: string; answer?: string },
  ) {
    this.core.active.release(chat.id, active);
    this.settleUnread(chat);
    void this.core.storage
      .syncSummary(chat)
      .catch((e) => console.warn("Could not update the thread's summary:", e));
    const stepped = turn && this.councils.step(chat.id, turn);
    // Taken now, so the queue keeps its place ahead of anything sent after
    // the run ended. A step never takes this thread's control, so waiting
    // for it here can't deadlock.
    void this.core
      .control(chat.id, async () => {
        await stepped;
        await this.queue.drain(chat.id);
        // A reviewer's step waited for its queue; nothing went out after all.
        if (chat.reviewer && !this.core.active.has(chat.id))
          await this.councils.step(chat.id, {});
        await this.ended(chat.id);
        // A review that stopped or failed has no lead turn whose end would look at it.
        if (chat.reviewer) await this.ended(chat.reviewer.parent);
      })
      .catch((e) => console.warn("Could not send the queued messages:", e));
  }
  /** A turn the agent started beside the one holding the thread ended; that one ends the run. */
  rider(chat: ProjectChat, active: ActiveChat) {
    this.core.active.release(chat.id, active);
    void this.core.storage
      .syncSummary(chat)
      .catch((e) => console.warn("Could not update the thread's summary:", e));
  }
  /**
   * A turn stopped or failed before its agent ran, so no run ends to move a
   * review on: a reviewer's review takes its step here, or would wait for good.
   */
  unstarted(
    chat: ProjectChat,
    input: ProjectChatSend,
    answer?: string,
  ) {
    if (chat.reviewer)
      void this.councils.step(chat.id, {
        request: input.id,
        ...(answer ? { answer } : {}),
      });
  }
  /**
   * A steer the agent never confirmed reading went to it if its turn finished.
   * A stopped or failed turn drops what the agent hadn't picked up yet.
   */
  private settleUnread(chat: ProjectChat) {
    const unread = chat.messages.filter((m) => m.unread);
    for (const m of unread) {
      delete m.unread;
      const steered = [...chat.messages.slice(0, chat.messages.indexOf(m))]
        .reverse()
        .find(
          (a) =>
            a.role === "assistant" &&
            a.provider === m.provider &&
            (a.parentId ?? null) === (m.parentId ?? null),
        );
      if (steered?.status === "cancelled" || steered?.status === "failed")
        m.missed = true;
      m.version++;
      this.core.emit({ chatId: chat.id, message: structuredClone(m) });
    }
    if (unread.length)
      void this.core.storage
        .save(chat)
        .catch((e) => console.warn("Could not save the thread:", e));
  }
}
