import type { ProjectChat, ProjectChatSend } from "../../shared/projects";
import { replyRoot } from "../../shared/projects";
import { agentAsked } from "../../shared/recipient";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import type { ChatSchedule } from "./schedule";

export interface QueueHost {
  /** Starts the message's turn now; the thread must be idle. */
  sendNow(id: string, input: ProjectChatSend): Promise<void>;
}

/** Messages waiting for the thread's running answer, and steering it with one. */
export class ChatQueue {
  constructor(
    private core: ChatCore,
    private schedule: ChatSchedule,
    private councils: Pick<Councils, "busy">,
    private host: QueueHost,
  ) {}

  /** Queues a message behind the thread's running answer, and steers it with one sent to. */
  async add(id: string, input: ProjectChatSend) {
    const chat = await this.core.storage.load(id);
    if (
      chat.messages.some((m) => m.id === input.id) ||
      chat.queue?.some((q) => q.input.id === input.id)
    )
      return;
    if ((chat.queue?.length ?? 0) >= 20)
      throw new Error("This thread already has 20 queued messages.");
    if (
      Buffer.byteLength(JSON.stringify(chat.queue ?? [])) +
        Buffer.byteLength(JSON.stringify(input)) >
      8 * 1024 * 1024
    )
      throw new Error(
        "The message queue is full. Send or remove queued attachments first.",
      );
    input = {
      ...input,
      parentId: input.parentId
        ? replyRoot(chat.messages, input.parentId).id
        : undefined,
    };
    (chat.queue ??= []).push({ input, created: Date.now() });
    await this.core.storage.save(chat);
    if (input.delivery === "steer") await this.steer(chat, input.id);
  }

  /**
   * A message went out without queueing. Asking an agent again picks a
   * stopped queue back up after this answer; Relay's own messages leave it
   * stopped. Drain waits behind the sender's control, so it sees the change.
   */
  sentNow(id: string, input: ProjectChatSend, fromRelay: boolean) {
    const chat = this.core.storage.cached(id);
    if (chat?.queuePaused && agentAsked(input) && !fromRelay) {
      delete chat.queuePaused;
      return this.core.storage.save(chat);
    }
  }

  /** Sends the next queued message, unless the thread is busy or its queue stopped. */
  async drain(id: string) {
    if (this.core.closing() || this.core.active.has(id)) return;
    const chat = await this.core.storage.load(id);
    if (this.councils.busy(chat)) return;
    const next = chat.queue?.[0];
    if (!next || chat.queuePaused) return;
    try {
      await this.host.sendNow(id, next.input);
      chat.queue = chat.queue!.filter((q) => q.input.id !== next.input.id);
      await this.core.storage.save(chat);
      if (!this.core.active.has(id)) await this.drain(id);
    } catch (e) {
      next.error = e instanceof Error ? e.message : String(e);
      chat.queuePaused = true;
      await this.core.storage.save(chat);
    }
  }

  /**
   * Steers the running answer with a queued message: the message moves to the
   * front and the answer stops, so it goes out the moment the agent lets go.
   * Steering inside the turn waited for a running command to finish, minutes
   * at times. A turn that takes no steering (a compaction) finishes first.
   */
  private async steer(chat: ProjectChat, messageId: string) {
    const next = chat.queue?.find((q) => q.input.id === messageId),
      active = this.core.active.get(chat.id);
    if (!next) throw new Error("Queued message not found.");
    delete next.error;
    chat.queue = [next, ...chat.queue!.filter((q) => q !== next)];
    chat.queuePaused = false;
    await this.core.storage.save(chat);
    if (!active) return this.drain(chat.id);
    if (!agentAsked(next.input) || !active.steer || active.finishing) return;
    active.handover = true;
    this.core.active.stop(chat.id);
  }

  async action(
    id: string,
    action: "remove" | "steer" | "move",
    messageId: string,
    index = 0,
  ) {
    const sendNow = await this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      const chat = await this.core.storage.load(id);
      const scheduled = chat.scheduled?.find((s) => s.input.id === messageId);
      if (scheduled && action !== "move") {
        chat.scheduled = chat.scheduled!.filter((s) => s !== scheduled);
        await this.schedule.save(chat);
        return action === "steer" ? scheduled : undefined;
      }
      if (action === "steer") {
        await this.steer(chat, messageId);
        return;
      }
      if (action === "remove")
        chat.queue = chat.queue?.filter((q) => q.input.id !== messageId);
      else {
        const moving = chat.queue?.find((q) => q.input.id === messageId);
        if (!moving) throw new Error("Queued message not found.");
        const rest = chat.queue!.filter((q) => q !== moving);
        rest.splice(Math.min(index, rest.length), 0, moving);
        chat.queue = rest;
      }
      await this.core.storage.save(chat);
      await this.drain(id);
    });
    // Outside the control above, since send takes its own turn.
    if (sendNow)
      await this.schedule.dispatch(id, { ...sendNow, error: undefined });
  }
}
