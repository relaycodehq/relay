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
  /** Each thread as the last list read it, to tell when it starts waiting. */
  private known = new Map<string, ChatSummary>();
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
        const news = waitingNews(this.known.get(chat.id), chat);
        this.known.set(chat.id, chat);
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
  }

  private ended(turn: Turn) {
    if (!answersKinds.includes(turn.kind)) return;
    // Another answer still runs in the thread; its end tells, unless this one failed.
    if (
      turn.endedAs === "completed" &&
      this.ledger
        .inThread(turn.threadId)
        .some((t) => answersKinds.includes(t.kind))
    )
      return;
    const answer = turn.answerId
      ? this.threads.answer(turn.threadId, turn.answerId)
      : undefined;
    const chat = this.threads.summary(turn.threadId);
    if (!chat) return;
    const news = answerNews(turn, chat, answer);
    if (!news) return;
    this.tell(news, chat.projectId, {
      turnId: turn.id,
      ...(news.kind === "finished" && chat.startedBy
        ? { byAgent: true as const }
        : {}),
    });
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
    for (const listener of this.listeners) listener(item);
  }
}
