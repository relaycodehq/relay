import type { HandoffChat, HandoffLive } from "../../shared/handoff";
import type {
  ChatMessage,
  ChatSummary,
  KnownMessages,
} from "../../shared/projects";
import type { RemoteEvent } from "../../shared/remote";
import type { NewsItem } from "../../shared/thread-news";
import type { ProjectChats } from "../project-chats";

/** How the computers threads came from are reached. */
export interface FeedLink {
  send(deviceId: string, event: RemoteEvent): void;
}

type FeedChats = {
  liveHandoff: Pick<
    ProjectChats["liveHandoff"],
    "outgoing" | "writtenHere" | "live" | "started"
  >;
  handoffs: Pick<ProjectChats["handoffs"], "handedOver">;
};

/** Who follows a thread: a device, and what it knows the thread by. */
export interface Follower {
  /** The handoff that brought it here, or for a thread of this computer's own, its id. */
  handoffId: string;
  deviceId: string;
}

interface Followed extends Follower {
  projectId: string;
  /** The live state as last sent, its running time left out. */
  sent?: string;
}

/** A streaming answer goes across at most this often; the last of it always does. */
const streamMs = 150;
/** Thread lists move in bursts; they're read again once it settles. */
const settleMs = 100;

const liveKey = ({ runningFor: _, ...live }: HandoffLive) =>
  JSON.stringify(live);

/**
 * Keeps the computers following a thread here up to date with what's
 * written in it and what runs and waits there, once each has asked to
 * follow it (`handoffChat`): the one a handed-over thread came from, or any
 * paired computer for a thread of this computer's own. Not saved: a
 * computer that reconnects asks again.
 */
export class LiveFeed {
  private link?: FeedLink;
  /** By thread, then by device. */
  private followed = new Map<string, Map<string, Followed>>();
  private held = new Map<
    string,
    { timer: NodeJS.Timeout; next?: [string, RemoteEvent] }
  >();
  private settling = new Map<string, NodeJS.Timeout>();
  constructor(private chats: FeedChats) {}

  connect(link: FeedLink) {
    this.link = link;
  }

  /** The device follows the thread from now on; what it lacks comes back. */
  async follow(
    chat: ChatSummary,
    known: KnownMessages | undefined,
    who: Follower,
  ): Promise<HandoffChat> {
    const [messages, live] = await Promise.all([
      this.chats.liveHandoff.writtenHere(chat.id, known),
      this.chats.liveHandoff.live(chat.id),
    ]);
    // Only from here, or pushes could reach it ahead of the older answer.
    const devices = this.followed.get(chat.id) ?? new Map<string, Followed>();
    devices.set(who.deviceId, {
      ...who,
      projectId: chat.projectId,
      sent: liveKey(live),
    });
    this.followed.set(chat.id, devices);
    return { messages, live };
  }

  message(chatId: string, message: ChatMessage) {
    const devices = this.followed.get(chatId);
    if (!devices || !this.link) return;
    void this.chats.liveHandoff
      .outgoing(chatId, message)
      .then((out) => {
        if (out)
          for (const f of devices.values())
            this.push(f.deviceId, {
              kind: "message",
              chatId: f.handoffId,
              message: out,
            });
        if (message.status !== "streaming") return this.update(chatId);
      })
      .catch((e) => console.warn("A live handoff's message didn't go:", e));
  }

  /** News of a followed thread is the other computers' to tell there too. */
  news(item: NewsItem) {
    const devices = this.followed.get(item.chatId);
    if (!devices || !this.link) return;
    for (const f of devices.values())
      this.link.send(f.deviceId, {
        kind: "news",
        item: { ...item, chatId: f.handoffId },
      });
  }

  /**
   * The project's threads may read differently, and so may what a followed
   * thread in it says, or what a lead elsewhere says of the threads its
   * agent started in it.
   */
  changed(projectId: string) {
    if (!this.link || this.settling.has(projectId)) return;
    const timer = setTimeout(() => {
      this.settling.delete(projectId);
      const leads = this.chats.liveHandoff.started.leadsIn(projectId);
      for (const [chatId, devices] of this.followed)
        if (
          leads.has(chatId) ||
          [...devices.values()].some((f) => f.projectId === projectId)
        )
          void this.update(chatId).catch((e) =>
            console.warn("A live handoff's state didn't go:", e),
          );
    }, settleMs);
    timer.unref?.();
    this.settling.set(projectId, timer);
  }

  private async update(chatId: string) {
    const devices = this.followed.get(chatId);
    if (!devices) return;
    if (this.handedBack(chatId, devices)) {
      this.followed.delete(chatId);
      return;
    }
    const live = await this.chats.liveHandoff.live(chatId);
    const key = liveKey(live);
    for (const f of devices.values()) {
      if (key === f.sent) continue;
      f.sent = key;
      this.link?.send(f.deviceId, { kind: "handoff", id: f.handoffId, live });
    }
  }

  /** A thread handed here that's gone back, or was taken back: nobody follows it here anymore. */
  private handedBack(chatId: string, devices: Map<string, Followed>) {
    const [first] = devices.values();
    if (!first || first.handoffId === chatId) return false;
    const chat = this.chats.handoffs.handedOver(first.handoffId);
    return !chat || !!chat.cameFrom?.returnedAt || !!chat.cameFrom?.abandonedAt;
  }

  /** Sends a message, a streaming one at most every `streamMs`. */
  private push(deviceId: string, event: RemoteEvent & { kind: "message" }) {
    const key = `${deviceId}:${event.message.id}`;
    const held = this.held.get(key);
    if (event.message.status !== "streaming") {
      if (held) clearTimeout(held.timer);
      this.held.delete(key);
      this.link?.send(deviceId, event);
      return;
    }
    if (held) {
      held.next = [deviceId, event];
      return;
    }
    this.link?.send(deviceId, event);
    const entry: { timer: NodeJS.Timeout; next?: [string, RemoteEvent] } = {
      timer: setTimeout(() => {
        this.held.delete(key);
        if (entry.next)
          this.push(
            entry.next[0],
            entry.next[1] as RemoteEvent & { kind: "message" },
          );
      }, streamMs),
    };
    entry.timer.unref?.();
    this.held.set(key, entry);
  }
}
