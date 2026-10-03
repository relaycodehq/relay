import type { ProjectChat } from "../../shared/projects";
import type { ProjectSharing } from "../projects/project-sharing";
import type { ChatCore } from "./core";
import { chatSummary } from "./storage";

export interface SharingHost {
  /** Pulls the thread's shared messages and reads it back. */
  sync(id: string): Promise<unknown>;
}

/** Threads shared with others through the project's rooms server. */
export class ChatSharing {
  private syncing = new Map<string, Promise<void>>();
  constructor(
    private core: ChatCore,
    private remote: ProjectSharing | undefined,
    private host: SharingHost,
  ) {}

  /** Sends the thread's messages that haven't reached the server yet. */
  async deliver(chat: ProjectChat) {
    const pending = chat.messages.filter(
      (m) => m.pending && m.status !== "streaming",
    );
    if (!pending.length) return;
    const result = await this.remote!.send(chat, pending);
    for (const remote of result) {
      const local = chat.messages.find((m) => m.id === remote.id);
      if (local) {
        Object.assign(local, {
          author: remote.author,
          authorId: remote.authorId,
          seq: remote.seq,
          pending: false,
        });
        local.version++;
        this.core.emit({ chatId: chat.id, message: structuredClone(local) });
      }
    }
    await this.core.storage.save(chat);
  }

  async info(id: string) {
    const chat = await this.core.storage.load(id);
    if (!this.remote) throw new Error("Sharing is unavailable.");
    return {
      ...(await this.remote.info(chat.projectId)),
      messages: chat.messages.length,
    };
  }

  async share(id: string) {
    if (this.core.active.has(id))
      throw new Error(
        "Stop or finish the current answer before sharing this conversation.",
      );
    const chat = await this.core.storage.load(id);
    if (chat.messages.some((message) => message.images?.length))
      throw new Error(
        "This conversation contains private screenshots and cannot be shared yet.",
      );
    if (chat.scope.kind === "review")
      throw new Error("Deep reviews can't be shared yet.");
    if (chat.shared) return chatSummary(chat);
    if (!this.remote) throw new Error("Sharing is unavailable.");
    await this.remote.allow(chat.projectId);
    chat.shared = await this.remote.share(chat);
    await this.core.storage.persist(chat);
    await this.host.sync(id);
    return chatSummary(chat);
  }

  /** Delivers what's pending and takes in what others wrote; one at a time per thread. */
  async pull(id: string) {
    const existing = this.syncing.get(id);
    if (existing) return existing;
    const job = (async () => {
      const chat = await this.core.storage.load(id);
      if (!chat.shared) return;
      if (!this.remote) throw new Error("Sharing is unavailable.");
      await this.deliver(chat);
      let changed = false;
      for (let page = 0; page < 10; page++) {
        const result = await this.remote.poll(chat, chat.sharedCursor ?? 0);
        changed ||=
          result.messages.length > 0 || chat.sharedCursor !== result.next;
        chat.updated = Math.max(chat.updated, result.conversation.updated);
        for (const message of result.messages) {
          const local = chat.messages.find((m) => m.id === message.id);
          if (local) {
            Object.assign(local, {
              author: message.author,
              authorId: message.authorId,
              seq: message.seq,
              pending: false,
            });
            local.version++;
          } else chat.messages.push(message);
        }
        chat.sharedCursor = result.next;
        if (!result.more) break;
      }
      if (changed) {
        // Shared messages go by their place on the server and ones still to
        // deliver go last. A message never shared, like a handoff note or a
        // compaction, stays right after the one it followed.
        let after = 0;
        const place = new Map(
          chat.messages.map((m) => [
            m,
            m.seq ? (after = m.seq) : m.pending ? Infinity : after + 0.5,
          ]),
        );
        chat.messages.sort((a, b) => place.get(a)! - place.get(b)! || 0);
        await this.core.storage.persist(chat);
      }
    })();
    this.syncing.set(id, job);
    try {
      await job;
    } finally {
      this.syncing.delete(id);
    }
  }

  /** Pulls still running, for closing. */
  pulling() {
    return [...this.syncing.values()];
  }

  async presence(
    id: string,
    value: { path: string | null; viewed: number; total: number } | null,
  ) {
    const chat = await this.core.storage.load(id);
    if (!chat.shared || !this.remote) return [];
    return this.remote.presence(chat, value);
  }

  async workspace(id: string) {
    const chat = await this.core.storage.load(id);
    if (!chat.shared || !this.remote)
      throw new Error("Share the conversation before enabling live sync.");
    return this.remote.workspace(chat);
  }

  async invite(id: string) {
    const chat = await this.core.storage.load(id);
    if (!chat.shared || !this.remote)
      throw new Error("Share this conversation before inviting someone.");
    return this.remote.invite(chat);
  }

  async list(projectId: string) {
    if (!this.remote) throw new Error("Sharing is unavailable.");
    return this.remote.list(projectId);
  }

  async open(projectId: string, roomId: string) {
    const metadata = (await this.list(projectId)).find((c) => c.id === roomId);
    if (!metadata)
      throw new Error("Shared conversation not found in this project.");
    if (this.core.storage.has(roomId)) {
      const existing = await this.core.storage.load(roomId);
      if (existing.projectId !== projectId)
        throw new Error(
          "This conversation is linked to another local project.",
        );
      return chatSummary(existing);
    }
    const chat: ProjectChat = { ...metadata, messages: [] };
    this.core.storage.keep(chat);
    await this.core.storage.save(chat);
    await this.core.storage.addSummary(chat);
    await this.host.sync(chat.id);
    return chatSummary(chat);
  }

  async join(projectId: string, url: string) {
    if (!this.remote) throw new Error("Sharing is unavailable.");
    const roomId = await this.remote.join(projectId, url);
    return roomId ? this.open(projectId, roomId) : null;
  }
}
