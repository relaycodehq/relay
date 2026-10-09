import type {
  HeldWakeup,
  ProjectChat,
  ProjectChatSend,
  ScheduledChatMessage,
  StoppedWork,
} from "../../shared/projects";
import { replyRoot } from "../../shared/projects";
import { stopClaudeTask } from "../agents/claude/project";
import type { ChatCore } from "./core";
import { sessionInput } from "./sessions";
import { nextSend } from "./storage";

export interface ScheduleHost {
  send(id: string, input: ProjectChatSend, fromRelay?: boolean): Promise<void>;
}

/**
 * Messages held for later: Send later ones, and what Claude left waiting
 * when Relay closed (one-shot wake-ups Relay sends itself, and background
 * work the thread offers to pick back up).
 */
export class ChatSchedule {
  /** Each chat's earliest Send later message, and the wake-ups Relay sends itself. */
  private timers = new Map<string, NodeJS.Timeout>();
  private pendingCopies = new Map<
    string,
    {
      chat: ProjectChat;
      heldWakeups: ProjectChat["heldWakeups"];
      stopped: ProjectChat["stopped"];
    }
  >();
  constructor(
    private core: ChatCore,
    private host: ScheduleHost,
  ) {}

  /** Arms the wake-ups kept when Relay last closed, and scheduled messages. */
  armAll() {
    for (const summary of this.core.store.get().chats ?? []) {
      // Cancellation can correct the cache while a failed disk write leaves
      // the listed summary stale. Never arm a discarded copy from that summary.
      const cached = this.core.storage.cached(summary.id);
      const chat = cached ?? summary;
      for (const wakeup of chat.heldWakeups ?? []) this.arm(chat.id, wakeup);
      const at = cached ? nextSend(cached.scheduled) : summary.nextSend;
      if (at) this.armSend(chat.id, at);
    }
  }

  /** Relay is closing; nothing more goes out on its own. */
  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
  }

  /**
   * Runs `due` at `at`, replacing the key's timer; no `at` just clears it. A
   * timer waits at most about 24.8 days, so a later one re-arms when it fires.
   */
  private armTimer(
    key: string,
    at: number | undefined,
    due: () => Promise<void>,
  ) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    if (!at || this.core.closing()) return;
    const delay = Math.min(Math.max(at - Date.now(), 0), 2 ** 31 - 1);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        if (Date.now() < at) return this.armTimer(key, at, due);
        void due().catch((e) =>
          console.warn("Could not send a scheduled message:", e),
        );
      }, delay),
    );
  }

  /** One that came due while Relay was closed goes out right after launch. */
  armSend(chatId: string, at: number | undefined) {
    this.armTimer("send:" + chatId, at, () => this.sendDue(chatId));
  }

  /** Holds a Send later message until its time; it then goes out like any other. */
  async add(id: string, { sendAt, delivery, ...input }: ProjectChatSend) {
    const at = sendAt!;
    const chat = await this.core.storage.load(id);
    if (
      chat.messages.some((m) => m.id === input.id) ||
      chat.scheduled?.some((s) => s.input.id === input.id)
    )
      return;
    // A phone may retry after losing the reply, even after the message ran.
    if (at <= Date.now()) throw new Error("Choose a time in the future.");
    if (at > Date.now() + 366 * 86_400_000)
      throw new Error("Schedule a message at most a year ahead.");
    if ((chat.scheduled?.length ?? 0) >= 20)
      throw new Error("This thread already has 20 scheduled messages.");
    if (
      Buffer.byteLength(JSON.stringify(chat.scheduled ?? [])) +
        Buffer.byteLength(JSON.stringify(input)) >
      8 * 1024 * 1024
    )
      throw new Error(
        "Too many scheduled attachments. Send or remove scheduled messages first.",
      );
    (chat.scheduled ??= []).push({
      input: {
        ...input,
        parentId: input.parentId
          ? replyRoot(chat.messages, input.parentId).id
          : undefined,
      },
      at,
      created: Date.now(),
    });
    await this.save(chat);
  }

  /** Saves the thread after its scheduled messages changed, and re-arms the earliest. */
  async save(chat: ProjectChat) {
    if (!chat.scheduled?.length) delete chat.scheduled;
    await this.core.storage.save(chat);
    this.armSend(chat.id, nextSend(chat.scheduled));
  }

  /** Sends the scheduled messages that are due, oldest first. */
  private async sendDue(chatId: string) {
    if (this.core.closing()) return;
    const due = await this.core.control(chatId, async () => {
      const chat = await this.core.storage.load(chatId);
      const now = Date.now();
      const due = (chat.scheduled ?? [])
        .filter((s) => !s.error && s.at <= now)
        .sort((a, b) => a.at - b.at);
      chat.scheduled = chat.scheduled?.filter((s) => !due.includes(s));
      await this.save(chat);
      return due;
    });
    for (const item of due) await this.dispatch(chatId, item);
  }

  /** Sends a scheduled message now; if that fails it stays, with the error. */
  async dispatch(chatId: string, item: ScheduledChatMessage) {
    try {
      await this.host.send(chatId, item.input);
    } catch (e) {
      await this.core.control(chatId, async () => {
        const chat = await this.core.storage.load(chatId);
        (chat.scheduled ??= []).push({
          ...item,
          error: e instanceof Error ? e.message : String(e),
        });
        await this.save(chat);
      });
    }
  }

  private arm(chatId: string, wakeup: HeldWakeup) {
    // One that came due while Relay was closed goes out shortly after launch.
    this.armTimer(
      `wake:${chatId}:${wakeup.id}`,
      Math.max(wakeup.at, Date.now() + 15_000),
      () => this.fireWakeup(chatId, wakeup.id),
    );
  }

  private async dropWakeup(chat: ProjectChat, id: string) {
    chat.heldWakeups = chat.heldWakeups?.filter((w) => w.id !== id);
    if (!chat.heldWakeups?.length) delete chat.heldWakeups;
    await this.core.storage.save(chat);
  }

  private async fireWakeup(chatId: string, id: string) {
    if (this.core.closing()) return;
    const chat = await this.core.storage.load(chatId);
    const wakeup = chat.heldWakeups?.find((w) => w.id === id);
    if (!wakeup) return;
    await this.dropWakeup(chat, id);
    await this.host.send(
      chatId,
      {
        ...sessionInput(chat, "claude", this.core.store, wakeup.parentId),
        body: `@claude Relay restarted before your scheduled wake-up, so it's sending it for you:\n\n${wakeup.prompt}`,
      },
      true,
    );
  }

  /**
   * Stops a background task Claude left running, or cancels a wake-up it
   * scheduled. The SDK can't delete wake-ups, so Claude is asked to, in the open.
   */
  async stopPending(id: string, pendingId: string) {
    const chat = await this.core.storage.load(id);
    // Its timer finds it gone and sends nothing.
    if (chat.heldWakeups?.some((w) => w.id === pendingId))
      return this.dropWakeup(chat, pendingId);
    const work = this.core.sessions
      .pending(id)
      .find((p) => p.item.id === pendingId);
    if (!work) throw new Error("That work has already finished.");
    if (work.item.kind === "task") return stopClaudeTask(work.key, pendingId);
    return this.host.send(
      id,
      {
        ...sessionInput(chat, "claude", this.core.store, work.parentId),
        body: `@claude Cancel the wake-up you scheduled (${pendingId}) with CronDelete, and don't do anything else.`,
      },
      true,
    );
  }

  /**
   * Relay is closing, and Claude's sessions with it. Background work dies
   * with them: remember it, so the thread can offer to pick it back up.
   * One-shot wake-ups carry their prompt and time, so Relay sends those itself.
   */
  async keepPending() {
    const now = Date.now();
    const left = this.core.sessions.pending();
    for (const chatId of new Set(left.map((p) => p.chatId))) {
      const chat = await this.core.storage.load(chatId).catch(() => undefined);
      if (!chat) continue;
      this.pendingCopies.set(chatId, {
        chat,
        heldWakeups: structuredClone(chat.heldWakeups),
        stopped: structuredClone(chat.stopped),
      });
      const stopped: StoppedWork[] = [];
      const work = left.filter((p) => p.chatId === chatId);
      for (const { item, parentId } of work) {
        const reply = parentId ? { parentId } : {};
        if (item.kind === "wakeup" && !item.recurring && item.at)
          (chat.heldWakeups ??= []).push({
            id: item.id,
            prompt: item.prompt,
            at: item.at,
            ...reply,
          });
        else stopped.push({ ...item, ...reply });
      }
      if (stopped.length)
        chat.stopped = {
          at: now,
          items: [...(chat.stopped?.items ?? []), ...stopped].slice(-20),
        };
      await this.core.storage.save(chat);
    }
  }

  /** A cancelled quit leaves Claude running; forget only the copies we made. */
  async rollbackPending() {
    const writes: Promise<void>[] = [];
    for (const { chat, heldWakeups, stopped } of this.pendingCopies.values()) {
      if (heldWakeups) chat.heldWakeups = heldWakeups;
      else delete chat.heldWakeups;
      if (stopped) chat.stopped = stopped;
      else delete chat.stopped;
      writes.push(
        this.core.storage.save(chat).catch((error) => {
          console.warn("Could not undo copied background work:", error);
        }),
      );
    }
    this.commitPending();
    await Promise.all(writes);
  }

  commitPending() {
    this.pendingCopies.clear();
  }

  async resolveStopped(id: string, action: "resume" | "dismiss") {
    const chat = await this.core.storage.load(id);
    const stopped = chat.stopped;
    if (!stopped) return;
    delete chat.stopped;
    await this.core.storage.save(chat);
    if (action === "dismiss") return;
    // Each conversation's Claude hears about the work it started.
    for (const parentId of new Set(stopped.items.map((i) => i.parentId))) {
      const lines = stopped.items
        .filter((item) => item.parentId === parentId)
        .map((item) =>
          item.kind === "task"
            ? `- Background work: ${item.description}`
            : `- Recurring wake-up: ${item.prompt}`,
        );
      await this.host.send(
        id,
        {
          ...sessionInput(chat, "claude", this.core.store, parentId),
          body: `@claude Relay closed while you were waiting on these, so they stopped:\n${lines.join("\n")}\n\nCheck where they got to and pick the work back up.`,
        },
        true,
      );
    }
  }
}
