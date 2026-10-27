import type { AccountProvider } from "../../shared/agent-accounts";
import {
  chatSettled,
  sameTriageState,
  setTriageState,
  triageState,
} from "../../shared/chat-activity";
import {
  linkedFoldersSchema,
  type ChatTriage,
  type LinkedFolder,
  type ProjectChat,
} from "../../shared/projects";
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
    if (
      triage.kind === "unread" ||
      triage.kind === "auto-settle" ||
      triage.kind === "pin"
    ) {
      if (triage.kind === "unread") chat.markedUnread = true;
      else if (triage.kind === "pin") {
        if (!triage.pinned) delete chat.pinnedAt;
        else chat.pinnedAt ??= now;
      } else if (triage.enabled) delete chat.autoSettleOff;
      else chat.autoSettleOff = true;
      await this.core.storage.save(chat);
      return chatSummary(chat);
    }
    if (triage.kind === "archive") {
      this.refuseWhileGoing(chat, "archiving");
      chat.archivedAt = now;
      await this.core.storage.save(chat);
      // A teardown can take minutes; the thread is archived meanwhile.
      void this.core
        .control(id, () => this.dropLanded(id, now, !!triage.dropWorktree))
        .catch((e) => console.warn("Could not drop an archived worktree:", e));
      return chatSummary(chat);
    }
    if (triage.kind === "settle-when-done" && chat.waiting)
      throw new Error("Answer the waiting request before settling.");
    // A phone's card can be a couple of seconds behind the live turn.
    if (
      triage.kind === "settle" &&
      (this.core.active.has(id) || this.councils.busy(chat) || chat.waiting)
    )
      throw new Error(
        "Wait for the running answer and its requests before settling.",
      );
    // Before anything changes: the loaded thread is the one kept in memory.
    if (triage.kind === "snooze" && triage.until <= now)
      throw new Error("Choose a future wake time.");
    delete chat.snoozedAt;
    delete chat.snoozedUntil;
    delete chat.settleWhenDone;
    if (triage.kind === "settle" || triage.kind === "settle-when-done") {
      chat.settledAt = now;
      // Done already, it is a plain settle.
      if (triage.kind === "settle-when-done" && this.going(chat))
        chat.settleWhenDone = now;
    } else if (triage.kind === "unsettle" || triage.kind === "snooze")
      delete chat.settledAt;
    // Settled by hand or automatically, moving it back keeps it out until something new happens.
    if (triage.kind === "unsettle") chat.unsettledAt = now;
    if (triage.kind === "snooze") {
      chat.snoozedAt = now;
      chat.snoozedUntil = triage.until;
    }
    await this.core.storage.save(chat);
    // Settle-when-done that waits for the run settles them once it ends.
    if (
      triage.kind === "settle" ||
      (triage.kind === "settle-when-done" && !chat.settleWhenDone)
    )
      await this.settleStarted(id, now);
    return chatSummary(chat);
  }

  /**
   * Called once a run ended and its queue went out: a thread settled while it
   * ran settles for real if nothing is left going, or comes back to Activity
   * when its answer failed or was stopped, quitting Relay included.
   */
  async ended(id: string) {
    const chat = await this.core.storage.load(id);
    const since = chat.settleWhenDone;
    if (!since || this.going(chat)) return;
    const answer = chat.messages
      .filter((m) => m.role === "assistant" && !m.parentId)
      .at(-1);
    // A turn a restart left running, about to be taken back.
    if (answer?.status === "streaming") return;
    const failed =
      chatSummary(chat).asking ||
      answer?.status !== "complete" ||
      (chat.stopped && chat.stopped.at >= since);
    // Its agent asked, not the user: it waits for them to read the answer.
    if (!failed && chat.settledAt == null && !this.read(chat)) return;
    delete chat.settleWhenDone;
    const now = Date.now();
    if (failed) delete chat.settledAt;
    else chat.settledAt = now;
    await this.core.storage.save(chat);
    if (chat.settledAt) await this.settleStarted(id, now);
  }

  /**
   * Its own agent asks to settle it. Unlike a settle by hand it stays in
   * Activity meanwhile, and settles once this answer and its queue end
   * cleanly and the user has read it; a thread another started doesn't wait
   * for that, its lead reads it. False when it's settled already.
   */
  async settleItself(id: string) {
    const chat = await this.core.storage.load(id);
    if (chatSettled(chat)) return false;
    chat.settleWhenDone = Date.now();
    await this.core.storage.save(chat);
    return true;
  }

  /** The user has read its latest answer; a lead reads the threads it started. */
  private read(chat: ProjectChat) {
    return (
      !!chat.startedBy ||
      (!chat.markedUnread && (chat.seenAt ?? 0) >= chat.updated)
    );
  }

  /**
   * After Relay starts: a quit cut off the runs of threads settled while
   * they ran, and no run ending will look at them again.
   */
  async restarted() {
    const ids = (this.core.store.get().chats ?? [])
      .filter((c) => c.settleWhenDone)
      .map((c) => c.id);
    for (const id of ids)
      await this.ended(id).catch((e) =>
        console.warn("Could not settle a thread settled while running:", e),
      );
  }

  /**
   * Nothing reopens an archived or deleted thread to stop what runs in it,
   * or to cancel what would still go out by itself.
   */
  private refuseWhileGoing(chat: ProjectChat, doing: string) {
    if (this.core.active.has(chat.id) || this.councils.busy(chat))
      throw new Error(`Stop the running answer before ${doing}.`);
    if (
      nextSend(chat.scheduled) ||
      chat.heldWakeups?.length ||
      this.core.sessions.pending(chat.id).length
    )
      throw new Error(
        `Cancel the scheduled messages and Claude's background work before ${doing}.`,
      );
  }

  /** Something runs in the thread now, or is about to go on by itself. */
  private going(chat: ProjectChat) {
    return (
      this.core.active.has(chat.id) ||
      this.councils.busy(chat) ||
      this.core.sessions.pending(chat.id).length > 0 ||
      (!!chat.queue?.length && !chat.queuePaused) ||
      !!nextSend(chat.scheduled)
    );
  }

  /** Your own message to a thread settled while it ran brings it back. */
  async sent(id: string) {
    const chat = await this.core.storage.load(id);
    if (!chat.settleWhenDone) return;
    delete chat.settleWhenDone;
    delete chat.settledAt;
    await this.core.storage.save(chat);
  }

  /**
   * Removes the worktree of a thread still archived since `at`, if all of it
   * landed, or anyway when `asked`; then its branch stays.
   */
  private async dropLanded(id: string, at: number, asked: boolean) {
    const chat = await this.core.storage.load(id);
    if (chat.archivedAt !== at) return;
    if (asked) await this.worktrees.dropArchived(chat);
    else await this.worktrees.dropLanded(chat, at);
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
      const going = this.going(child) || !!child.waiting;
      if (going || chatSummary(child).asking || child.settledAt) continue;
      // The settle overlay wins while present; keep the snooze underneath for Undo.
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
    if (chat.reviewer)
      throw new Error("A reviewer stays with its deep review.");
    if (this.core.active.has(chat.startedBy.chatId))
      throw new Error(
        "The thread that started it is working; detach once it's done.",
      );
    delete chat.startedBy;
    await this.core.storage.save(chat);
    return chatSummary(chat);
  }

  /** Lets this thread's agent drive any thread without asking, or takes that back. */
  async allowDriving(id: string, on: boolean) {
    const chat = await this.core.storage.load(id);
    if (!!chat.drivesThreads === on) return chatSummary(chat);
    if (on) chat.drivesThreads = true;
    else delete chat.drivesThreads;
    await this.core.storage.save(chat);
    return chatSummary(chat);
  }

  /** Only moves forward, so a device that read less can't mark a thread unread again. */
  async markSeen(id: string, seenAt: number) {
    const chat = await this.core.storage.load(id);
    if ((chat.seenAt ?? 0) >= seenAt && !chat.markedUnread) return;
    chat.seenAt = Math.max(chat.seenAt ?? 0, seenAt);
    delete chat.markedUnread;
    // A seen mark changes no message: beside the thread, it's a few hundred
    // bytes, where saving it whole rewrote a long thread (MBs) at every look.
    await this.core.storage.checkpoint(chat);
    // Its agent asked to settle it once read.
    if (chat.settleWhenDone && chat.settledAt == null) await this.ended(id);
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

  /** Project and thread link scopes commit together in the state file. */
  async promoteLink(id: string, path: string) {
    const chat = await this.core.storage.load(id);
    await this.core.store.update((s) => {
      const thread = s.chats!.find((c) => c.id === id)!;
      const moving = thread.links?.find((l) => l.path === path);
      if (!moving)
        throw new Error("That folder is no longer linked to this thread.");
      const project = s.projects!.find((p) => p.id === chat.projectId)!;
      project.settings = {
        ...project.settings,
        links: linkedFoldersSchema.parse([
          ...(project.settings?.links ?? []).filter((l) => l.path !== path),
          moving,
        ]),
      };
      const kept = thread.links!.filter((l) => l.path !== path);
      if (kept.length) thread.links = kept;
      else delete thread.links;
    });
    const saved = this.core.store.get().chats!.find((c) => c.id === id)!;
    if (saved.links) chat.links = saved.links;
    else delete chat.links;
    this.core.storage.summariesChanged(chat.projectId);
    return {
      project: this.core.projects.get(chat.projectId),
      chat: chatSummary(chat),
    };
  }

  /** Thread links live in the state file, alongside project links, rather than a second write. */
  async setLinks(id: string, links: LinkedFolder[]) {
    const chat = await this.core.storage.load(id);
    await this.core.store.update((s) => {
      const thread = s.chats!.find((c) => c.id === id)!;
      if (links.length) thread.links = links;
      else delete thread.links;
    });
    if (links.length) chat.links = links;
    else delete chat.links;
    this.core.storage.summariesChanged(chat.projectId);
    return chatSummary(chat);
  }
}
