/**
 * A thread's messages as the desktop pushes them to its windows. A streaming
 * answer goes as a patch on the copy a window last got (shared/remote-delta,
 * as phones get it), so each update carries its new words instead of the
 * whole answer: a 50KB answer sent whole every 40ms cost a window over 1MB/s
 * to copy and read. Whatever isn't streaming goes whole, so a window never
 * ends on a patch it couldn't place.
 */
import type { ProjectChatEvent } from "./events";
import type { ChatMessage } from "./projects";
import {
  applyMessagePatch,
  diffMessage,
  type MessagePatch,
} from "./remote-delta";

/** A streaming answer's change since the copy a window last got; `base` is that copy's version. */
export interface ProjectChatPatchEvent {
  chatId: string;
  patch: MessagePatch;
  base: number;
  title?: string;
}

/** What goes to a window on "relay:project-chat". */
export type ProjectChatPush = ProjectChatEvent | ProjectChatPatchEvent;

/** A thread's own answer, still streaming: the only kind that goes as patches. */
const patchable = (event: ProjectChatEvent) =>
  event.message.status === "streaming" && !event.setup;

/**
 * An answer that settled ends its turn. Both ends then forget every copy
 * they hold of the thread's answers, so one that stopped streaming without
 * a word, like the line of a reload that failed, isn't kept for good.
 */
const endsTurn = (event: ProjectChatEvent) =>
  !event.setup &&
  event.message.role === "assistant" &&
  event.message.status !== "streaming";

/** The copies of streaming answers one end holds, by thread and message. */
class HeldAnswers {
  private threads = new Map<string, Map<string, ChatMessage>>();

  get(chatId: string, id: string) {
    return this.threads.get(chatId)?.get(id);
  }

  set(chatId: string, message: ChatMessage) {
    let thread = this.threads.get(chatId);
    if (!thread) this.threads.set(chatId, (thread = new Map()));
    thread.set(message.id, message);
  }

  delete(chatId: string, id: string) {
    this.threads.get(chatId)?.delete(id);
  }

  /** What `event`, which goes whole, leaves held. */
  settle(event: ProjectChatEvent) {
    if (endsTurn(event)) this.threads.delete(event.chatId);
    else this.delete(event.chatId, event.message.id);
  }
}

/**
 * The desktop's side: remembers what each window last got of every streaming
 * answer. A window that starts listening, or lost track, asks for `resync`.
 */
export class ChatPushSender<Target extends object> {
  private sent = new WeakMap<Target, HeldAnswers>();

  constructor(
    /** A deep copy: the event may hold the live answer its recorder keeps writing into. */
    private copy: <T>(value: T) => T,
  ) {}

  /** What each of `targets` gets for `event`. */
  pushes(
    event: ProjectChatEvent,
    targets: Target[],
  ): [Target, ProjectChatPush][] {
    if (!patchable(event)) {
      for (const target of targets) this.sent.get(target)?.settle(event);
      return targets.map((target) => [target, event]);
    }
    const { chatId, message } = event;
    let whole: ChatMessage | undefined;
    // Windows that got the same copy last time get the same patch now.
    const patches = new Map<
      ChatMessage,
      [ProjectChatPatchEvent, ChatMessage]
    >();
    return targets.map((target) => {
      const sent = this.sentTo(target);
      const prev = sent.get(chatId, message.id);
      if (!prev) {
        sent.set(chatId, (whole ??= this.copy(message)));
        return [target, event];
      }
      let patched = patches.get(prev);
      if (!patched) {
        const patch = diffMessage(prev, message);
        // The copy a window holds next is the one before with the patch on
        // it, which copies only what changed instead of the whole answer.
        const next = applyMessagePatch(prev, this.copy(patch));
        const push: ProjectChatPatchEvent = {
          chatId,
          patch,
          base: prev.version,
          ...(event.title ? { title: event.title } : {}),
        };
        patches.set(prev, (patched = [push, next]));
      }
      sent.set(chatId, patched[1]);
      return [target, patched[0]];
    });
  }

  /** `target` gets every streaming answer whole next time. */
  resync(target: Target) {
    this.sent.delete(target);
  }

  private sentTo(target: Target) {
    let sent = this.sent.get(target);
    if (!sent) this.sent.set(target, (sent = new HeldAnswers()));
    return sent;
  }
}

/**
 * A window's side: holds the copy of each streaming answer that the next
 * patch builds on. One it can't place asks for whole copies once, through
 * `resync`; the answer's next update then comes whole.
 */
export class ChatPushReceiver {
  private held = new HeldAnswers();
  /** Answers whose patches couldn't be placed, waiting for a whole copy. */
  private missing = new Set<string>();

  constructor(private resync: () => void) {}

  /** The event `push` stands for; nothing for a patch on a copy this window doesn't hold. */
  take(push: ProjectChatPush): ProjectChatEvent | undefined {
    if ("message" in push) {
      this.missing.delete(push.message.id);
      if (patchable(push)) this.held.set(push.chatId, push.message);
      else this.held.settle(push);
      return push;
    }
    const { chatId, patch } = push;
    const prev = this.held.get(chatId, patch.id);
    if (prev?.version !== push.base) {
      this.held.delete(chatId, patch.id);
      this.lost(patch.id);
      return undefined;
    }
    const message = applyMessagePatch(prev, patch);
    this.held.set(chatId, message);
    return {
      chatId,
      message,
      ...(push.title ? { title: push.title } : {}),
    };
  }

  private lost(id: string) {
    if (this.missing.has(id)) return; // asked already
    this.missing.add(id);
    this.resync();
  }
}
