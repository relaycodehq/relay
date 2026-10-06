import type {
  ChatMessage,
  LimitResume,
  ProjectChat,
} from "../../shared/projects";
import type { AgentError } from "../agents/errors";
import { usageResetsAt } from "../agents/usage-limit";
import { hasAccounts } from "../../shared/agent-accounts";
import { accountFor } from "../agents/accounts";
import type { ChatCore } from "./core";

/** Resumes this long after the limit lifts, in case the provider's clock runs behind. */
const GRACE = 60_000;
/** The longest window a plan has is a week; a reset further out isn't one. */
const LONGEST = 8 * 86_400_000;

export interface LimitResumeHost {
  /** Carries the thread's last answer on, as Resume answer does, from a job holding the thread's control. */
  resume(id: string): Promise<void>;
}

/**
 * Nothing was said in the answer's conversation after it, so resuming the
 * thread's last input carries on exactly that answer. A side question
 * beside it doesn't count.
 */
function stillLast(chat: ProjectChat, message: ChatMessage) {
  const branch = message.parentId ?? undefined;
  const conversation = chat.messages.filter(
    (m) => (m.parentId ?? undefined) === branch && !m.side,
  );
  return (
    conversation.at(-1)?.id === message.id &&
    (chat.lastInput?.parentId ?? undefined) === branch
  );
}

/**
 * Answers a usage limit stopped, picked back up once the limit lifts. The
 * plan lives in the thread's summary, so a restart re-arms it; anything sent
 * in the thread meanwhile drops it, and it checks again before it goes.
 */
export class LimitResumes {
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(
    private core: ChatCore,
    private host: LimitResumeHost,
  ) {}

  armAll() {
    for (const chat of this.core.store.get().chats ?? [])
      this.arm(chat.id, chat.limitResume);
  }

  /** Relay is closing; what's planned waits for the next launch. */
  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /**
   * A usage limit stopped the answer `messageId`: it plans its resume for the
   * reset, on the same account.
   */
  async stopped(chatId: string, messageId: string, limit: AgentError) {
    const chat = await this.core.storage.load(chatId);
    const message = chat.messages.find((m) => m.id === messageId);
    // A reviewer's or thinker's thread is its council's to carry on.
    if (!message || chat.reviewer || chat.thinker) return;
    const { provider } = limit;
    const account = hasAccounts(provider)
      ? accountFor(provider, chat.accounts?.[provider])
      : undefined;
    const at =
      limit.resetsAt ??
      (await usageResetsAt(provider, account).catch(() => undefined));
    // A reset already past is stale: resuming on it would hit the limit again.
    if (!at || at <= Date.now() || at > Date.now() + LONGEST) return;
    await this.core.control(chatId, async () => {
      if (!stillLast(chat, message)) return;
      chat.limitResume = { messageId, provider: limit.provider, at };
      await this.core.storage.save(chat);
      this.arm(chatId, chat.limitResume);
    });
  }

  /** Turns the planned resume off for this answer, or back on. */
  set(chatId: string, on: boolean) {
    return this.core.control(chatId, async () => {
      const chat = await this.core.storage.load(chatId);
      const plan = chat.limitResume;
      if (!plan) return;
      if (on) delete plan.off;
      else plan.off = true;
      await this.core.storage.save(chat);
      this.arm(chatId, plan);
    });
  }

  private arm(chatId: string, plan: LimitResume | undefined) {
    clearTimeout(this.timers.get(chatId));
    this.timers.delete(chatId);
    if (!plan || plan.off || this.core.closing()) return;
    // One that came due while Relay was closed waits for launch to settle.
    const delay = Math.max(plan.at + GRACE - Date.now(), 15_000);
    this.timers.set(
      chatId,
      setTimeout(
        () =>
          void this.fire(chatId).catch((e) =>
            console.warn("Could not resume after the usage limit:", e),
          ),
        delay,
      ),
    );
  }

  private async fire(chatId: string) {
    this.timers.delete(chatId);
    if (this.core.closing()) return;
    // Decided inside the thread's job: a send queued ahead of it has landed.
    await this.core.control(chatId, async () => {
      const chat = await this.core.storage.load(chatId);
      const plan = chat.limitResume;
      if (!plan || plan.off) return;
      const message = chat.messages.find((m) => m.id === plan.messageId);
      const go =
        !!message &&
        !chat.archivedAt &&
        !chat.sentTo &&
        stillLast(chat, message);
      // The limit paused the queue behind the answer; carrying on picks it up.
      const unpause = go && !!chat.queue?.length && !!chat.queuePaused;
      delete chat.limitResume;
      if (unpause) delete chat.queuePaused;
      await this.core.storage.save(chat);
      if (!go) return;
      try {
        await this.host.resume(chatId);
      } catch (e) {
        if (unpause) {
          chat.queuePaused = true;
          await this.core.storage.save(chat);
        }
        throw e;
      }
    });
  }
}
