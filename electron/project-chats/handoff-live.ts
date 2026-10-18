import type { HandoffLive, HeldSend } from "../../shared/handoff";
import type {
  ChatMessage,
  ChatSummary,
  KnownMessages,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import type { ChatCore } from "./core";
import { awaitsReturn } from "./handoff";

/**
 * A message written on the computer a thread was handed to, as the computer
 * it came from mirrors it: carried messages by their ids there, nothing that
 * points into this computer's data (turn snapshots, sessions).
 */
function mirrorOf(
  { changes, seq, forkPoint, unread, ...m }: ChatMessage,
  carriedIds: Record<string, string>,
): ChatMessage {
  return m.parentId && carriedIds[m.parentId]
    ? { ...m, parentId: carriedIds[m.parentId] }
    : m;
}

/** Saves of a streaming mirror wait this long; what's in memory is current. */
const mirrorSaveMs = 1000;

/**
 * A live handoff from both ends. The computer that took the thread hands
 * what's written in it, and what runs and waits there, to the one it came
 * from; that one keeps the thread as a mirror, everything after the
 * messages it left with written only by what arrives.
 */
export class LiveHandoff {
  private saves = new Map<string, NodeJS.Timeout>();
  constructor(
    private core: ChatCore,
    private list: (projectId: string) => ChatSummary[],
  ) {}

  /** For the computer the thread came from: the message as it mirrors it, unless it's one that came along. */
  async outgoing(id: string, message: ChatMessage) {
    const chat = await this.core.storage.load(id);
    if (!awaitsReturn(chat) || chat.carriedIds?.[message.id]) return;
    return {
      handoffId: chat.cameFrom!.id,
      deviceId: chat.cameFrom!.deviceId,
      message: mirrorOf(message, chat.carriedIds ?? {}),
    };
  }
  /** What was written here since the thread came; those it holds at the same version as their ids. */
  async writtenHere(id: string, known: KnownMessages = {}) {
    const chat = await this.core.storage.load(id);
    const carried = chat.carriedIds ?? {};
    return chat.messages
      .slice(chat.cameFrom?.carried ?? 0)
      .map((m) =>
        known[m.id] === m.version
          ? m.id
          : structuredClone(mirrorOf(m, carried)),
      );
  }
  /** A call's arguments from the computer the thread came from, carried messages by their ids here. */
  async inbound(id: string, args: unknown[]) {
    const chat = await this.core.storage.load(id);
    const here = new Map(
      Object.entries(chat.carriedIds ?? {}).map(([mine, theirs]) => [
        theirs,
        mine,
      ]),
    );
    const rename = (value: unknown, depth: number): unknown => {
      if (typeof value === "string") return here.get(value) ?? value;
      if (depth > 3 || !value || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map((v) => rename(v, depth + 1));
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, rename(v, depth + 1)]),
      );
    };
    return args.map((a) => rename(a, 0));
  }
  /** What runs and waits in the thread here, for the computer it came from. */
  async live(id: string): Promise<HandoffLive> {
    const chat = await this.core.storage.load(id);
    const listed = this.list(chat.projectId).find((c) => c.id === id);
    const requests = this.core.active.requests(id);
    return structuredClone({
      ...(listed?.running
        ? {
            running: true as const,
            runningFor: Date.now() - (listed.runningSince ?? Date.now()),
          }
        : {}),
      ...(listed?.runningAgents?.length
        ? { runningAgents: listed.runningAgents }
        : {}),
      ...(listed?.waiting ? { waiting: true as const } : {}),
      ...(listed?.blocked ? { blocked: true as const } : {}),
      ...(listed?.asking ? { asking: true as const } : {}),
      ...(listed?.pending?.length ? { pending: listed.pending } : {}),
      ...(chat.stopped ? { stopped: chat.stopped } : {}),
      ...(chat.limitResume ? { limitResume: chat.limitResume } : {}),
      ...(chat.goal ? { goal: chat.goal } : {}),
      ...(requests?.length ? { requests } : {}),
      ...(chat.queue?.length ? { queue: chat.queue } : {}),
      ...(chat.scheduled?.length ? { scheduled: chat.scheduled } : {}),
      ...(chat.queuePaused ? { queuePaused: true as const } : {}),
    });
  }

  /** The thread is live on `handoffId`, away and following it. */
  private following(chat: ProjectChat, handoffId: string) {
    const { sentTo } = chat;
    return (
      sentTo?.id === handoffId &&
      sentTo.live &&
      sentTo.kept !== undefined &&
      sentTo.state !== "sending"
    );
  }
  /** The mirrored messages held, by version, so a reconnect sends only what changed. */
  async held(id: string): Promise<KnownMessages> {
    const chat = await this.core.storage.load(id);
    const kept = chat.sentTo?.kept;
    if (kept === undefined) return {};
    return Object.fromEntries(
      chat.messages.slice(kept).map((m) => [m.id, m.version]),
    );
  }
  /** A message written on the computer the thread is on: added, or in place of the copy held. */
  async mirror(id: string, handoffId: string, message: ChatMessage) {
    const chat = await this.core.storage.load(id);
    if (!this.following(chat, handoffId)) return;
    const kept = chat.sentTo!.kept!;
    const at = chat.messages.findIndex((m) => m.id === message.id);
    if (at >= 0 && at < kept) return;
    // Attachment copies can leave a push behind a newer reconnect snapshot.
    if (at >= 0 && chat.messages[at].version >= message.version) return;
    if (at >= 0) chat.messages[at] = message;
    else {
      chat.messages.push(message);
      chat.updated = Date.now();
    }
    this.core.emit({ chatId: id, message: structuredClone(message) });
    if (message.status === "streaming") this.saveSoon(chat);
    else await this.saveNow(chat);
  }
  /**
   * The thread as the other computer has it after a reconnect: every
   * message after the ones it left with, those already held named by id.
   */
  async synced(
    id: string,
    handoffId: string,
    messages: (ChatMessage | string)[],
  ) {
    const chat = await this.core.storage.load(id);
    if (!this.following(chat, handoffId)) return;
    const kept = chat.sentTo!.kept!;
    const held = new Map(chat.messages.slice(kept).map((m) => [m.id, m]));
    const next = messages.flatMap((m) => {
      const known = held.get(typeof m === "string" ? m : m.id);
      if (typeof m === "string") return known ? [known] : [];
      // A push that overtook the answer is newer than it.
      return known && known.version > m.version ? [known] : [m];
    });
    const changed = next.filter((m) => held.get(m.id) !== m);
    const before = chat.messages.length;
    chat.messages = [...chat.messages.slice(0, kept), ...next];
    if (!changed.length && chat.messages.length === before) return;
    if (changed.length) chat.updated = Date.now();
    await this.saveNow(chat);
    for (const m of changed)
      this.core.emit({ chatId: id, message: structuredClone(m) });
    // Messages gone there can't be said one by one.
    if (chat.messages.length !== before) this.core.storage.chatChanged(id);
  }
  /** What the other computer says runs and waits in the thread now. */
  setLive(id: string, live: HandoffLive | undefined) {
    const away = this.core.away;
    if (!away) return;
    const { runningFor, ...rest } = live ?? {};
    const next = live && {
      ...rest,
      ...(runningFor !== undefined
        ? { runningSince: Date.now() - runningFor }
        : {}),
    };
    if (JSON.stringify(away.get(id)) === JSON.stringify(next)) return;
    if (next) away.set(id, next);
    else away.delete(id);
    this.core.storage.chatChanged(id);
  }
  /** Sends that wait for the computer the thread is live on. */
  async outbox(id: string): Promise<HeldSend[]> {
    return structuredClone((await this.core.storage.load(id)).outbox ?? []);
  }
  /** A send waits for the computer the thread is live on to be back. */
  async hold(id: string, handoffId: string, input: ProjectChatSend) {
    const chat = await this.core.storage.load(id);
    if (chat.sentTo?.id !== handoffId || !chat.sentTo.live)
      throw new Error("This thread isn't live on another computer.");
    if (chat.outbox?.some((h) => h.input.id === input.id)) return;
    chat.outbox = [...(chat.outbox ?? []), { input, at: Date.now() }];
    await this.core.storage.save(chat);
  }
  /** Takes every held send out, to go out here instead. */
  async takeOut(id: string): Promise<HeldSend[]> {
    const chat = await this.core.storage.load(id);
    const held = (chat.outbox ?? []).map(({ error: _, ...h }) => h);
    if (!held.length) return [];
    delete chat.outbox;
    await this.core.storage.save(chat);
    return held;
  }
  /**
   * Sends that didn't go out here wait in the thread again, ahead of any
   * held since; the first says why. One that landed after all stays out.
   */
  async putBack(id: string, held: HeldSend[], error: string) {
    const chat = await this.core.storage.load(id);
    const landed = new Set([
      ...chat.messages.map((m) => m.id),
      ...(chat.queue ?? []).map((q) => q.input.id),
    ]);
    const back = held
      .filter((h) => !landed.has(h.input.id))
      .map((h, i) => (i ? h : { ...h, error }));
    if (!back.length) return;
    chat.outbox = [...back, ...(chat.outbox ?? [])];
    await this.core.storage.save(chat);
    this.core.storage.chatChanged(id);
  }
  /** A held send went out, or was dropped; `error` keeps it, turned down. */
  async settle(id: string, sendId: string, error?: string) {
    const chat = await this.core.storage.load(id);
    const held = chat.outbox?.find((h) => h.input.id === sendId);
    if (!held) return;
    if (error) held.error = error;
    else chat.outbox = chat.outbox!.filter((h) => h !== held);
    if (!chat.outbox?.length) delete chat.outbox;
    await this.core.storage.save(chat);
    this.core.storage.chatChanged(id);
  }
  private saveSoon(chat: ProjectChat) {
    if (this.saves.has(chat.id)) return;
    this.saves.set(
      chat.id,
      setTimeout(() => void this.saveNow(chat), mirrorSaveMs),
    );
  }
  private async saveNow(chat: ProjectChat) {
    clearTimeout(this.saves.get(chat.id));
    this.saves.delete(chat.id);
    await this.core.storage
      .save(chat)
      .catch((e) => console.warn("A live handoff's thread wasn't saved:", e));
  }
  dispose() {
    for (const timer of this.saves.values()) clearTimeout(timer);
    this.saves.clear();
  }
}
