import type { HandoffChat, HandoffLive } from "../../shared/handoff";
import type {
  ChatMessage,
  ChatSummary,
  KnownMessages,
} from "../../shared/projects";
import type { RemoteEvent } from "../../shared/remote";
import type { ProjectChats } from "../project-chats";

/** How the computers threads came from are reached. */
export interface FeedLink {
  send(deviceId: string, event: RemoteEvent): void;
}

type FeedChats = Pick<
  ProjectChats,
  "handoffOutgoing" | "handoffWritten" | "handoffLive" | "handedOver"
>;

interface Followed {
  handoffId: string;
  deviceId: string;
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
 * On the computer that took threads over: keeps the computer each came from
 * up to date with what's written in it and what runs and waits there, once
 * that computer has asked to follow it (`handoffChat`). Not saved: a
 * computer that reconnects asks again.
 */
export class LiveFeed {
  private link?: FeedLink;
  private followed = new Map<string, Followed>();
  private held = new Map<
    string,
    { timer: NodeJS.Timeout; next?: [string, RemoteEvent] }
  >();
  private settling = new Map<string, NodeJS.Timeout>();
  constructor(private chats: FeedChats) {}
  connect(link: FeedLink) {
    this.link = link;
  }
  /** The computer the thread came from follows it from now on; what it lacks comes back. */
  async follow(chat: ChatSummary, known?: KnownMessages): Promise<HandoffChat> {
    const [messages, live] = await Promise.all([
      this.chats.handoffWritten(chat.id, known),
      this.chats.handoffLive(chat.id),
    ]);
    // Only from here, or pushes could reach it ahead of the older answer.
    this.followed.set(chat.id, {
      handoffId: chat.cameFrom!.id,
      deviceId: chat.cameFrom!.deviceId,
      projectId: chat.projectId,
      sent: liveKey(live),
    });
    return { messages, live };
  }
  message(chatId: string, message: ChatMessage) {
    const entry = this.followed.get(chatId);
    if (!entry || !this.link) return;
    void this.chats
      .handoffOutgoing(chatId, message)
      .then((out) => {
        if (out)
          this.push(out.deviceId, {
            kind: "message",
            chatId: out.handoffId,
            message: out.message,
          });
        if (message.status !== "streaming") return this.update(chatId);
      })
      .catch((e) => console.warn("A live handoff's message didn't go:", e));
  }
  changed(projectId: string) {
    if (!this.link || this.settling.has(projectId)) return;
    const timer = setTimeout(() => {
      this.settling.delete(projectId);
      for (const [chatId, entry] of this.followed)
        if (entry.projectId === projectId)
          void this.update(chatId).catch((e) =>
            console.warn("A live handoff's state didn't go:", e),
          );
    }, settleMs);
    timer.unref?.();
    this.settling.set(projectId, timer);
  }
  private async update(chatId: string) {
    const entry = this.followed.get(chatId);
    if (!entry) return;
    const chat = this.chats.handedOver(entry.handoffId);
    if (!chat || chat.cameFrom?.returnedAt || chat.cameFrom?.abandonedAt) {
      this.followed.delete(chatId);
      return;
    }
    const live = await this.chats.handoffLive(chatId);
    const key = liveKey(live);
    if (key === entry.sent) return;
    entry.sent = key;
    this.link?.send(entry.deviceId, {
      kind: "handoff",
      id: entry.handoffId,
      live,
    });
  }
  /** Sends a message, a streaming one at most every `streamMs`. */
  private push(deviceId: string, event: RemoteEvent & { kind: "message" }) {
    const key = event.message.id;
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
