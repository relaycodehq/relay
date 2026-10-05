import type { ChatMessage } from "../../shared/projects";
import { diffChats, diffMessage } from "../../shared/remote-delta";
import type {
  RemoteChatSummary,
  RemoteEvent,
  ServerFrame,
} from "../../shared/remote";

/**
 * Unacknowledged streaming bytes one link may hold. A fast link acknowledges
 * long before it fills, so it streams every update; on EDGE it fills and the
 * phone gets the newest snapshot as soon as the last one is through, instead
 * of a queue of stale ones that keeps it further and further behind.
 */
const window = 16 * 1024;
/** Gives up on an acknowledgement after this, so a lost one can't stall a link for good. */
const ackMs = 20_000;

type MessageEvent = Extract<RemoteEvent, { kind: "message" }>;

/**
 * One client's events from `compactBridge` on: streaming answers and thread
 * lists go as patches on what this link last got (shared/remote-delta), and
 * streaming frames wait for room. Everything else goes at once, whole; so does
 * an answer once it stops streaming, so a client never ends on a patch it
 * couldn't place.
 */
export class LinkSender {
  private sent = new Map<string, ChatMessage>();
  private chats?: RemoteChatSummary[];
  /** The newest snapshot per streaming message not yet sent, oldest waiting first. */
  private held = new Map<string, MessageEvent>();
  private unacked = new Map<number, { bytes: number; at: number }>();
  private seq = 0;
  constructor(
    /** Sends a frame and says how many bytes it took on the wire. */
    private send: (frame: ServerFrame) => number,
    private now = Date.now,
  ) {}
  event(event: RemoteEvent) {
    if (event.kind === "chats") return this.sendChats(event.chats);
    if (event.kind !== "message") {
      this.send({ t: "event", event });
      return;
    }
    const { id } = event.message;
    this.held.delete(id);
    if (event.message.status === "streaming") {
      this.held.set(id, event);
      return this.pump();
    }
    this.sent.delete(id);
    this.send({ t: "event", event });
  }
  /** The client has the streaming frame numbered `s`. */
  got(s: number) {
    if (this.unacked.delete(s)) this.pump();
  }
  private sendChats(chats: RemoteChatSummary[]) {
    const prev = this.chats;
    this.chats = chats;
    if (!prev) {
      this.send({ t: "event", event: { kind: "chats", chats } });
      return;
    }
    const patch = diffChats(prev, chats);
    if (patch.set.length || patch.remove.length)
      this.send({ t: "event", event: { kind: "chatsPatch", patch } });
  }
  private pump() {
    const at = this.now();
    let inFlight = 0;
    for (const [s, frame] of this.unacked)
      if (at - frame.at > ackMs) this.unacked.delete(s);
      else inFlight += frame.bytes;
    while (this.held.size && inFlight < window) {
      const [id, event] = this.held.entries().next().value!;
      this.held.delete(id);
      const prev = this.sent.get(id);
      this.sent.set(id, event.message);
      const s = ++this.seq;
      const bytes = this.send({
        t: "event",
        s,
        event: prev
          ? {
              kind: "messagePatch",
              chatId: event.chatId,
              patch: diffMessage(prev, event.message),
              ...(event.title ? { title: event.title } : {}),
            }
          : event,
      });
      this.unacked.set(s, { bytes, at });
      inFlight += bytes;
    }
  }
}
