import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  ChatSummary,
  ProjectChat,
} from "../../shared/projects";
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

export interface NewsThreads {
  /** The thread's list entry, for one no longer in memory. */
  summary(chatId: string): ChatSummary | undefined;
  /** The message a turn wrote, as the thread in memory has it. */
  answer(chatId: string, answerId: string): ChatMessage | undefined;
  /** Messages wait in the thread's queue and will go out next. */
  queued(chatId: string): boolean;
  /**
   * The thread as news reads it, from memory and the ledger rather than the
   * project's list; `chat` is the copy just saved.
   */
  thread(chatId: string, chat?: ProjectChat): ChatSummary | undefined;
  /** Whether that thread waits on you, without the rest; undefined for one not in memory. */
  waiting(chatId: string, chat?: ProjectChat): boolean | undefined;
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
  /** Whether each thread waited when news last looked; one it hasn't seen yet isn't news. */
  private waited = new Map<string, boolean>();
  /** A finished answer whose news waits for the thread's next end, by thread. */
  private held = new Map<string, Turn>();
  private disposed = false;
  private unsubscribe: () => void;

  constructor(
    private ledger: TurnLedger,
    private threads: NewsThreads,
  ) {
    // Decided as the turn ends, so news is out before anyone hears the thread went idle.
    this.unsubscribe = ledger.onEvent((event) => {
      try {
        if (event.type === "ended") this.ended(event.turn);
        // A turn opening, asking or ending can change whether its thread waits on you.
        this.looked(event.turn.threadId);
      } catch (e) {
        console.warn("Could not tell of the turn:", e);
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

  /**
   * The thread was saved: a question in it may be open now, or its queue
   * cleared or paused with nothing run after a held answer.
   */
  saved(chat: ProjectChat) {
    if (this.disposed) return;
    try {
      this.looked(chat.id, chat);
      const held = this.held.get(chat.id);
      if (held && !this.busy(chat.id)) {
        this.held.delete(chat.id);
        this.tellEnd(held);
      }
    } catch (e) {
      console.warn("Could not tell of the thread:", e);
    }
  }

  /** News another computer decided, of a thread handed to it live. */
  retell(
    { byAgent, ...news }: ThreadNews & Pick<NewsItem, "byAgent">,
    projectId: string,
  ) {
    if (!this.disposed) this.tell(news, projectId, byAgent ? { byAgent } : {});
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe();
    this.listeners.clear();
    this.held.clear();
  }

  /** Tells of the thread when it started waiting on you since news last looked. */
  private looked(threadId: string, saved?: ProjectChat) {
    // Asked on every save of a streaming answer: the whole summary only when it may be news.
    const waiting = this.threads.waiting(threadId, saved);
    if (waiting === undefined) return;
    const waited = this.waited.get(threadId);
    this.waited.set(threadId, waiting);
    if (waited !== false || !waiting) return;
    const chat = this.threads.thread(threadId, saved);
    const news = chat && waitingNews(waited, chat);
    if (news) this.tell(news, chat.projectId);
  }

  private ended(turn: Turn) {
    if (!answersKinds.includes(turn.kind)) return;
    const { threadId } = turn;
    // Another answer still runs in the thread, or a queued message goes out
    // next: the thread's last end tells, unless this one failed.
    if (turn.endedAs === "completed" && this.busy(threadId)) {
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

  private busy(threadId: string) {
    return (
      this.threads.queued(threadId) ||
      this.ledger.inThread(threadId).some((t) => answersKinds.includes(t.kind))
    );
  }

  private tellEnd(turn: Turn) {
    if (turn.endedAs !== "completed" && turn.endedAs !== "failed") return false;
    const answer = turn.answerId
      ? this.threads.answer(turn.threadId, turn.answerId)
      : undefined;
    // From memory: the list hears of the turn's last save only after it ends.
    const chat =
      this.threads.thread(turn.threadId) ?? this.threads.summary(turn.threadId);
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
