import { rm } from "node:fs/promises";
import type { ProjectChatEvent } from "../../shared/events";
import type {
  ChatMessage,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import { replyRoot } from "../../shared/projects";
import { agentAsked } from "../../shared/recipient";
import type { ActiveTurns } from "./active";
import type { ThreadControl } from "./control";
import type { ChatSchedule } from "./schedule";
import type { ChatSharing } from "./sharing";
import type { ChatStorage } from "./storage";

export interface QueueHost {
  /** Starts the message's turn now; the thread must be idle. */
  sendNow(id: string, input: ProjectChatSend): Promise<void>;
  /** Deep review reviewers or Ultraplan thinkers are still at work in the thread. */
  councilBusy(chat: ProjectChat): boolean;
  closing(): boolean;
}

/**
 * Whether a queued message can join the answer running for `prior` instead of
 * waiting for it: the same agent, conversation and settings, and nothing the
 * agent only takes at the start of a turn (a selection, a skill, a command,
 * or a screenshot in a shared thread).
 */
export function steers(
  next: ProjectChatSend,
  prior: ProjectChatSend | undefined,
  shared: boolean,
) {
  const asked = agentAsked(next);
  return !(
    !asked ||
    !prior ||
    asked.provider !== agentAsked(prior)?.provider ||
    next.parentId !== prior.parentId ||
    next.runtimeMode !== prior.runtimeMode ||
    next.interactionMode !== prior.interactionMode ||
    JSON.stringify(next.choice) !== JSON.stringify(prior.choice) ||
    next.contextWindow !== prior.contextWindow ||
    (shared && next.images?.length) ||
    next.selection ||
    /(?:^|\s)(?:\$|\/skill:)/.test(asked.question) ||
    /^\s*\//.test(asked.question)
  );
}

/** Messages waiting for the thread's running answer, and steering it with one. */
export class ChatQueue {
  constructor(
    private storage: ChatStorage,
    private active: ActiveTurns,
    private schedule: ChatSchedule,
    private sharing: ChatSharing,
    private control: ThreadControl,
    private emit: (event: ProjectChatEvent) => void,
    private host: QueueHost,
  ) {}

  /** Queues a message behind the thread's running answer, and steers it with one sent to. */
  async add(id: string, input: ProjectChatSend) {
    const chat = await this.storage.load(id);
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
    await this.storage.save(chat);
    if (input.delivery === "steer") await this.steer(chat, input.id);
  }

  /** Sends the next queued message, unless the thread is busy or its queue stopped. */
  async drain(id: string) {
    if (this.host.closing() || this.active.has(id)) return;
    const chat = await this.storage.load(id);
    if (this.host.councilBusy(chat)) return;
    const next = chat.queue?.[0];
    if (!next || chat.queuePaused) return;
    try {
      await this.host.sendNow(id, next.input);
      chat.queue = chat.queue!.filter((q) => q.input.id !== next.input.id);
      await this.storage.save(chat);
      if (!this.active.has(id)) await this.drain(id);
    } catch (e) {
      next.error = e instanceof Error ? e.message : String(e);
      chat.queuePaused = true;
      await this.storage.save(chat);
    }
  }

  /**
   * Steers the running answer with a queued message. When it cannot steer
   * (different agent, model or mode, a selection, not started yet), the
   * message moves to the front and goes out as soon as the answer finishes.
   */
  private async steer(chat: ProjectChat, messageId: string) {
    const next = chat.queue?.find((q) => q.input.id === messageId),
      active = this.active.get(chat.id);
    if (!next) throw new Error("Queued message not found.");
    delete next.error;
    chat.queue = [next, ...chat.queue!.filter((q) => q !== next)];
    chat.queuePaused = false;
    if (!active) {
      await this.storage.save(chat);
      return this.drain(chat.id);
    }
    const asked = agentAsked(next.input);
    if (
      !asked ||
      !active.steer ||
      !steers(next.input, active.input, !!chat.shared)
    )
      return this.storage.save(chat);
    const images = next.input.images?.length
      ? await this.storage.saveImages(chat.id, next.input.images)
      : [];
    const message: ChatMessage = {
      id: next.input.id,
      steered: true,
      unread: true,
      role: "user",
      body: next.input.body,
      provider: asked.provider,
      status: "complete",
      created: Date.now(),
      version: 1,
      ...(images.length ? { images } : {}),
      ...(next.input.parentId ? { parentId: next.input.parentId } : {}),
      ...(chat.shared ? { pending: true } : {}),
    };
    // In the thread before the agent hears it: Codex can say it read the
    // steer in the same breath as accepting it, and its answer continues
    // below this message only if it's there to find.
    chat.messages.push(message);
    try {
      await active.steer(
        asked.question +
          (next.input.viewing
            ? `\nThe file I am viewing is ${JSON.stringify(next.input.viewing)}.`
            : ""),
        next.input.id,
        images.map((image) => ({
          path: this.storage.imagePath(chat.id, image),
          mimeType: image.mimeType,
        })),
      );
    } catch {
      chat.messages.splice(chat.messages.indexOf(message), 1);
      // Sent later as its own turn, which saves its images again.
      await Promise.all(
        images.map((image) =>
          rm(this.storage.imagePath(chat.id, image), { force: true }),
        ),
      );
      return this.storage.save(chat);
    }
    chat.queue = chat.queue!.filter((q) => q !== next);
    await this.storage.save(chat);
    this.emit({ chatId: chat.id, message });
    if (chat.shared) await this.sharing.deliver(chat).catch(() => {});
  }

  async action(
    id: string,
    action: "remove" | "steer" | "move",
    messageId: string,
    index = 0,
  ) {
    const sendNow = await this.control(id, async () => {
      if (this.host.closing()) throw new Error("Relay is closing.");
      const chat = await this.storage.load(id);
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
      await this.storage.save(chat);
      await this.drain(id);
    });
    // Outside the control above, since send takes its own turn.
    if (sendNow)
      await this.schedule.dispatch(id, { ...sendNow, error: undefined });
  }
}
