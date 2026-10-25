import type {
  KnownMessages,
  ProjectChat,
  ProjectChatPatch,
} from "../../shared/projects";
import { threadCost } from "../../shared/thread-cost";
import type { ChatCore } from "./core";
import { chatStatus } from "./status";
import type { ThreadList } from "./thread-list";
import type { ThreadWorktrees } from "./worktrees";

/**
 * Threads as callers read them: a copy of the saved thread with what it waits
 * on, here or on the computer it was handed to, or just how it stands.
 */
export class ChatReads {
  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
    private threads: ThreadList,
  ) {}

  /**
   * What waits in the thread now, which isn't saved with it; for a live
   * handoff, what its computer last said, over what's saved here.
   */
  private waitingIn(chat: ProjectChat) {
    if (!chat.sentTo?.live && !chat.sentTo?.setup)
      return { requests: this.core.active.requests(chat.id) };
    const {
      requests = [],
      queue,
      scheduled,
      queuePaused,
      stopped,
      limitResume,
      goal,
    } = this.core.away?.get(chat.id) ?? {};
    return {
      requests,
      queue,
      scheduled,
      queuePaused,
      stopped,
      limitResume,
      goal,
    };
  }

  async get(id: string): Promise<ProjectChat> {
    const chat = await this.core.storage.load(id);
    await this.worktrees.agents.refresh(chat);
    return {
      ...structuredClone(chat),
      ...structuredClone(this.waitingIn(chat)),
    };
  }

  /** Progress reads use the cached thread, without cloning its history or refreshing Git. */
  async status(id: string) {
    return (await this.statuses({ ids: [id] }))[0];
  }

  /** One live summary list per project, even when a tool waits on many threads. */
  async statuses(
    selection: { ids: readonly string[] } | { startedBy: string },
  ) {
    const ids =
      "ids" in selection
        ? selection.ids
        : (this.core.store.get().chats ?? [])
            .filter(
              (c) =>
                c.startedBy?.chatId === selection.startedBy && !c.archivedAt,
            )
            .map((c) => c.id);
    const loaded = new Map(
      await Promise.all(
        ids.map(async (id) => [id, await this.core.storage.load(id)] as const),
      ),
    );
    const summaries = this.threads.byIds(ids);
    // Explicit IDs retain caller order (and missing-ID errors). Started
    // threads retain the project grouping and updated order of the sidebar.
    const ordered = "ids" in selection ? ids : [...summaries.keys()];
    return ordered.map((id) => {
      const chat = loaded.get(id)!;
      const summary = summaries.get(id);
      if (!summary || summary.archivedAt) throw new Error("Chat not found.");
      return chatStatus(summary, { ...chat, ...this.waitingIn(chat) });
    });
  }

  /** Like get, but messages the caller already holds at the same version come back as their ids. */
  async changes(id: string, known: KnownMessages): Promise<ProjectChatPatch> {
    const saved = await this.core.storage.load(id);
    await this.worktrees.agents.refresh(saved);
    const { messages, ...chat } = saved;
    return {
      ...structuredClone(chat),
      messages: messages.map((m) =>
        known[m.id] === m.version ? m.id : structuredClone(m),
      ),
      ...structuredClone(this.waitingIn(saved)),
    };
  }

  async cost(id: string) {
    return threadCost((await this.core.storage.load(id)).messages);
  }

  /** The screenshots of a queued or scheduled message; it is gone once it has been sent. */
  async queuedImages(chatId: string, messageId: string) {
    const chat = await this.core.storage.load(chatId);
    const waiting = [...(chat.queue ?? []), ...(chat.scheduled ?? [])].find(
      (q) => q.input.id === messageId,
    );
    if (!waiting) throw new Error("That message is no longer waiting.");
    return structuredClone(waiting.input.images ?? []);
  }
}
