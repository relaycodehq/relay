import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatSummary } from "../../shared/projects";
import {
  answerNews,
  waitingNews,
  type NewsCatchUp,
  type NewsCursor,
  type NewsItem,
  type ThreadNews,
} from "../../shared/thread-news";
import { answersKinds, type Turn } from "../../shared/turns";
import type { TurnLedger } from "./ledger";

/** News kept for a client catching up; one further behind starts from the list. */
const KEEP_NEWS = 500;
/** How often a project's list is read for threads that started needing you. */
const LIST_MS = 50;

export interface NewsThreads {
  /** The thread's list entry as it reads now. */
  summary(chatId: string): ChatSummary | undefined;
  /** The message a turn wrote, as the thread in memory has it. */
  answer(chatId: string, answerId: string): ChatMessage | undefined;
  /** Messages wait in the thread's queue and will go out next. */
  queued(chatId: string): boolean;
  list(projectId: string): ChatSummary[];
}

/**
 * What threads are news of, decided once here for every window, menubar and
 * phone (docs/turn-lifecycle.md): an answer's end when its turn ends, a
 * question when a thread starts needing you. Each item is numbered; a client
 * that was away asks for what came after the last one it had.
 */
export class TurnNews {
  private epoch = randomUUID();
  private seq = 0;
  private items: NewsItem[] = [];
  private listeners = new Set<(item: NewsItem) => void>();
  /** Whether each thread waited when the last list read it. */
  private waited = new Map<string, boolean>();
  /** A finished answer whose news waits for the thread's next end, by thread. */
  private held = new Map<string, Turn>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribe: () => void;

  constructor(
    private ledger: TurnLedger,
    private threads: NewsThreads,
  ) {
    // Decided as the turn ends, so news is out before anyone hears the thread went idle.
    this.unsubscribe = ledger.onEvent((event) => {
      if (event.type !== "ended") return;
      try {
        this.ended(event.turn);
      } catch (e) {
        console.warn("Could not tell of the turn's end:", e);
      }
    });
  }

  onNews(listener: (item: NewsItem) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** What came after `cursor`; without one, or too far behind, only where the news is now. */
  since(cursor?: NewsCursor): NewsCatchUp {
    const now = { epoch: this.epoch, seq: this.seq };
    if (!cursor || cursor.epoch !== this.epoch || cursor.seq > this.seq)
      return now;
    const first = this.items[0]?.seq ?? this.seq + 1;
    if (cursor.seq < first - 1) return now;
    return { ...now, items: this.items.filter((i) => i.seq > cursor.seq) };
  }

  /** The project's list may read differently; a thread in it may need you now. */
  changed(projectId: string) {
    if (this.timers.has(projectId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(projectId);
      let chats: ChatSummary[];
      try {
        chats = this.threads.list(projectId);
      } catch {
        return; // The project is gone.
      }
      for (const chat of chats) {
        const news = waitingNews(this.waited.get(chat.id), chat);
        this.waited.set(chat.id, !!chat.waiting);
        if (news) this.tell(news, chat.projectId);
      }
    }, LIST_MS);
    timer.unref?.();
    this.timers.set(projectId, timer);
  }

  dispose() {
    this.unsubscribe();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
    this.held.clear();
  }

  private ended(turn: Turn) {
    if (!answersKinds.includes(turn.kind)) return;
    const { threadId } = turn;
    // Another answer still runs in the thread, or a queued message goes out
    // next: the thread's last end tells, unless this one failed.
    if (
      turn.endedAs === "completed" &&
      (this.threads.queued(threadId) ||
        this.ledger
          .inThread(threadId)
          .some((t) => answersKinds.includes(t.kind)))
    ) {
      this.held.set(threadId, turn);
      return;
    }
    const held = this.held.get(threadId);
    this.held.delete(threadId);
    // The last one ended without news of its own and not by your hand: the
    // finished one before it is the news.
    if (!this.tellEnd(turn) && held && turn.endedAs !== "cancelled")
      this.tellEnd(held);
  }

  private tellEnd(turn: Turn) {
    const answer = turn.answerId
      ? this.threads.answer(turn.threadId, turn.answerId)
      : undefined;
    const chat = this.threads.summary(turn.threadId);
    const news = chat && answerNews(turn, chat, answer);
    if (!news) return false;
    this.tell(news, chat.projectId, {
      turnId: turn.id,
      ...(news.kind === "finished" && chat.startedBy
        ? { byAgent: true as const }
        : {}),
    });
    return true;
  }

  private tell(
    news: ThreadNews,
    projectId: string,
    more: Pick<NewsItem, "turnId" | "byAgent"> = {},
  ) {
    const item: NewsItem = {
      ...news,
      ...more,
      projectId,
      seq: ++this.seq,
      at: Date.now(),
    };
    this.items.push(item);
    if (this.items.length > KEEP_NEWS) this.items.shift();
    for (const listener of this.listeners)
      try {
        listener(item);
      } catch (e) {
        console.warn("A news listener failed:", e);
      }
  }
}
