import type { AccountProvider } from "../../shared/agent-accounts";
import {
  sameTriageState,
  setTriageState,
  triageState,
} from "../../shared/chat-activity";
import type { ChatTriage } from "../../shared/projects";
import { accountFor } from "../agents/accounts";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { chatSummary, nextSend } from "./storage";
import type { ThreadWorktrees } from "./worktrees";

/** Where a thread sits in the sidebar and what it has been read up to; never what its agent does. */
export class ThreadTriage {
  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
    private councils: Councils,
  ) {}
  /** Settle/snooze/archive only change sidebar visibility, never the agent. */
  async triage(id: string, triage: ChatTriage) {
    const chat = await this.core.storage.load(id);
    const now = Date.now();
    if (triage.kind === "restore") {
      if (!sameTriageState(triageState(chat), triage.from))
        throw new Error(
          "This thread changed since, so there's nothing to undo.",
        );
      const settled = chat.settledAt;
      setTriageState(chat, triage.to);
      await this.core.storage.save(chat);
      // Undoing a settle brings back the threads it settled along with it.
      if (settled && chat.settledAt !== settled)
        for (const child of await this.started(id))
          if (child.settledAt === settled) {
            delete child.settledAt;
            await this.core.storage.save(child);
          }
      return chatSummary(chat);
    }
    if (triage.kind === "unread" || triage.kind === "auto-settle") {
      if (triage.kind === "unread") chat.markedUnread = true;
      else if (triage.enabled) delete chat.autoSettleOff;
      else chat.autoSettleOff = true;
      await this.core.storage.save(chat);
      return chatSummary(chat);
    }
    if (triage.kind === "archive") {
      if (this.core.active.has(id) || this.councils.busy(chat))
        throw new Error("Stop the running answer before archiving.");
      // Nothing reopens an archived thread to cancel what would still run in it.
      if (
        nextSend(chat.scheduled) ||
        chat.heldWakeups?.length ||
        this.core.sessions.pending(id).length
      )
        throw new Error(
          "Cancel the scheduled messages and Claude's background work before archiving.",
        );
      chat.archivedAt = now;
      await this.core.storage.save(chat);
      // A teardown can take minutes; the thread is archived meanwhile.
      void this.core
        .control(id, () => this.dropLanded(id, now))
        .catch((e) => console.warn("Could not drop an archived worktree:", e));
      return chatSummary(chat);
    }
    delete chat.snoozedAt;
    delete chat.snoozedUntil;
    if (triage.kind === "settle") chat.settledAt = now;
    else if (triage.kind === "unsettle" || triage.kind === "snooze")
      delete chat.settledAt;
    // Settled by hand or automatically, moving it back keeps it out until something new happens.
    if (triage.kind === "unsettle") chat.unsettledAt = now;
    if (triage.kind === "snooze") {
      if (triage.until <= now) throw new Error("Choose a future wake time.");
      chat.snoozedAt = now;
      chat.snoozedUntil = triage.until;
    }
    await this.core.storage.save(chat);
    if (triage.kind === "settle") await this.settleStarted(id, now);
    return chatSummary(chat);
  }
  /** Removes the worktree of a thread still archived since `at`, if all of it landed. */
  private async dropLanded(id: string, at: number) {
    const chat = await this.core.storage.load(id);
    if (chat.archivedAt !== at) return;
    await this.worktrees.dropLanded(chat, at);
    await this.core.storage.save(chat);
  }
  /** The threads `id`'s agent started, still listed. */
  private async started(id: string) {
    const ids = (this.core.store.get().chats ?? [])
      .filter((c) => c.startedBy?.chatId === id && !c.archivedAt)
      .map((c) => c.id);
    return Promise.all(ids.map((c) => this.core.storage.load(c)));
  }
  /**
   * Settling a thread settles the threads its agent started that are done
   * too, at the same moment, so undo finds them. One still working, asking
   * or about to go on stays out until it's done.
   */
  private async settleStarted(id: string, now: number) {
    for (const child of await this.started(id)) {
      const going =
        this.core.active.has(child.id) ||
        this.core.sessions.pending(child.id).length > 0 ||
        (!!child.queue?.length && !child.queuePaused) ||
        !!nextSend(child.scheduled);
      if (going || child.settledAt) continue;
      delete child.snoozedAt;
      delete child.snoozedUntil;
      child.settledAt = now;
      await this.core.storage.save(child);
    }
  }
  /**
   * Makes a started thread its own: its lead's tools no longer reach it and
   * settling the lead leaves it be. Not while the lead works, since a
   * wait_for_threads would stop counting it halfway.
   */
  async detach(id: string) {
    const chat = await this.core.storage.load(id);
    if (!chat.startedBy) return chatSummary(chat);
    if (this.core.active.has(chat.startedBy.chatId))
      throw new Error(
        "The thread that started it is working; detach once it's done.",
      );
    delete chat.startedBy;
    await this.core.storage.save(chat);
    return chatSummary(chat);
  }
  /** Only moves forward, so a device that read less can't mark a thread unread again. */
  async markSeen(id: string, seenAt: number) {
    const chat = await this.core.storage.load(id);
    if ((chat.seenAt ?? 0) >= seenAt && !chat.markedUnread) return;
    chat.seenAt = Math.max(chat.seenAt ?? 0, seenAt);
    delete chat.markedUnread;
    await this.core.storage.save(chat);
  }
  /** Runs `provider` on another account here, from the thread's next turn. */
  async setAccount(id: string, provider: AccountProvider, account: string) {
    if (accountFor(provider, account) !== account)
      throw new Error("That account is gone.");
    const chat = await this.core.storage.load(id);
    chat.accounts = { ...chat.accounts, [provider]: account };
    await this.core.storage.save(chat);
    return chatSummary(chat);
  }
}
