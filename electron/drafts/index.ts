import { randomUUID } from "node:crypto";
import type { ProjectChatSend } from "../../shared/projects";
import {
  draftThread,
  hasExtras,
  type DraftChange,
  type DraftDevice,
  type DraftWrite,
  type HeldSend,
  type HeldSendResult,
  type SharedDraft,
} from "../../shared/drafts";
import { DraftStore } from "./store";

export { DraftStore };
export {
  pasteSize,
  pastesRoot,
  readPaste,
  writePasteChunk,
  savePaste,
  setPastesRoot,
  sweepPastesSoon,
} from "./pastes";
export { keptToSend } from "./attached";
export { receiveFileChunk, writeUploadChunk } from "./uploads";

/** How long a phone's send waits on the desktop's page; the phone gives a send two minutes. */
const heldSendMs = 110_000;

/** How long a send the phone gave up on is kept for its retry; a retry comes well within it. */
const lateSendMs = 15 * 60_000;

/** A phone's send waiting on a desktop page. */
interface Held {
  request: HeldSend;
  /** The page's answer, however long it takes. */
  sent: Promise<{ chatId: string }>;
  done(result: HeldSendResult): void;
  /** The phone's tries still waiting on it: a retry waits beside the first. */
  waiting: number;
  /** Nobody waits on it any more: a page that comes next doesn't pick it up. */
  overdue?: true;
  /** Gives up on the page once no retry is coming. */
  forget?: ReturnType<typeof setTimeout>;
}

/** One phone send of one draft, across the phone's retries. */
const sendOf = (key: string, send: ProjectChatSend) =>
  JSON.stringify([key, send.id]);

/**
 * The computer's drafts, shared by its windows and phones (see
 * shared/drafts), and the phone sends that need the desktop's composer: a
 * draft with a screenshot or code reference in it goes out from the page
 * that holds them.
 */
export class Drafts {
  private held = new Map<string, Held>();
  /** New threads a page started after the phone stopped waiting, for its retry. */
  private wentLate = new Map<string, { chatId: string }>();

  constructor(
    private store: DraftStore,
    private hooks: {
      changed(change: DraftChange): void;
      /** Hands a send to a desktop page, opening one if need be; false when there's none to be had. */
      deliver?(request: HeldSend): boolean;
    },
  ) {}

  list(): SharedDraft[] {
    return this.store.list();
  }

  /** The draft as it stands after the write, null once it's gone. */
  write(write: DraftWrite, by: DraftDevice): SharedDraft | null {
    const change = this.store.write(write, by);
    if (change) this.hooks.changed(change);
    return change ? change.draft : (this.store.get(write.key) ?? null);
  }

  /** Swaps in the version a clash kept, or with `drop` lets it go. */
  other(key: string, drop: boolean): SharedDraft | null {
    const change = this.store.other(key, drop);
    if (change) this.hooks.changed(change);
    return this.store.get(key) ?? null;
  }

  /** Forgets the drafts of deleted threads, their replies' too. */
  forgetThreads(chatIds: readonly string[]) {
    const gone = this.store
      .list()
      .map((draft) => draft.key)
      .filter((key) => chatIds.includes(draftThread(key)?.chatId ?? ""));
    for (const change of this.store.remove(gone)) this.hooks.changed(change);
  }

  /** Whether a phone's send of the draft must go through the desktop's page, which holds part of it. */
  holds(key: string) {
    return !!this.hooks.deliver && hasExtras(this.store.get(key)?.extras);
  }

  /** The new thread a send went to after the phone stopped waiting on it, told once. */
  sentLate(key: string, send: ProjectChatSend) {
    const sent = this.wentLate.get(sendOf(key, send));
    this.wentLate.delete(sendOf(key, send));
    return sent;
  }

  /**
   * Sends the phone's message with what the desktop's page holds of the
   * draft; the thread it went to. A retry of a send the page is still on
   * waits for that one rather than sending it again.
   */
  async sendHeld(
    key: string,
    chatId: string | undefined,
    send: ProjectChatSend,
  ): Promise<{ chatId: string }> {
    const held =
      [...this.held.values()].find(
        ({ request }) => request.key === key && request.send.id === send.id,
      ) ?? this.hold(key, chatId, send);
    clearTimeout(held.forget);
    delete held.overdue;
    return this.waitFor(held);
  }

  private hold(
    key: string,
    chatId: string | undefined,
    send: ProjectChatSend,
  ): Held {
    const request: HeldSend = {
      id: randomUUID(),
      key,
      ...(chatId ? { chatId } : {}),
      send,
    };
    // The version that went: a phone may type the next message before this one
    // is out, and the desktop too, so its edits from here on are later than this.
    const base = this.store.get(key)?.rev ?? 0;
    const at = Date.now();
    let resolve!: (sent: { chatId: string }) => void;
    let reject!: (error: Error) => void;
    const sent = new Promise<{ chatId: string }>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Nobody may be waiting on it by the time it fails.
    sent.catch(() => {});
    const held: Held = {
      request,
      sent,
      waiting: 0,
      done: (result) => {
        clearTimeout(held.forget);
        this.held.delete(request.id);
        if ("error" in result) return reject(new Error(result.error));
        // What went out goes from the draft, and with it the desktop's part;
        // anything written after it was sent stays.
        if (this.store.get(key))
          this.write({ key, text: "", base, at, sent: send.body }, "desktop");
        // A thread's own retry is a plain send, which knows its message.
        if (held.overdue && !chatId) this.keepLate(sendOf(key, send), result);
        resolve(result);
      },
    };
    this.held.set(request.id, held);
    if (!this.hooks.deliver?.(request))
      held.done({ error: "Open Relay on the computer to send this draft." });
    return held;
  }

  /**
   * Gives up waiting in time; the page may still send it, which a retry then
   * hears. It goes overdue only once no try waits on it any more.
   */
  private waitFor(held: Held) {
    held.waiting++;
    let waiting = true;
    const stopWaiting = () => {
      if (waiting) held.waiting--;
      waiting = false;
    };
    return new Promise<{ chatId: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        stopWaiting();
        if (!held.waiting) this.giveUpOn(held);
        reject(
          new Error("Relay on the computer didn't get to send it in time."),
        );
      }, heldSendMs);
      held.sent.then(resolve, reject).finally(() => {
        clearTimeout(timer);
        stopWaiting();
      });
    });
  }

  /** Nobody waits on it any more: a page loading next doesn't pick it up, and this one gets a while longer. */
  private giveUpOn(held: Held) {
    held.overdue = true;
    held.forget = setTimeout(
      () => held.done({ error: "The page never sent it." }),
      lateSendMs,
    );
  }

  private keepLate(sent: string, result: { chatId: string }) {
    this.wentLate.set(sent, result);
    setTimeout(() => {
      if (this.wentLate.get(sent) === result) this.wentLate.delete(sent);
    }, lateSendMs);
  }

  /** Sends still waiting on a page, for one that just loaded. */
  waitingSends(): HeldSend[] {
    return [...this.held.values()]
      .filter((held) => !held.overdue)
      .map((held) => held.request);
  }

  finishSend(id: string, result: HeldSendResult) {
    this.held.get(id)?.done(result);
  }

  /** The page that had them went: they go to the next one, unless nobody waits on them any more. */
  redeliver() {
    for (const held of this.held.values())
      if (held.overdue) held.done({ error: "The page sending it went." });
      else this.hooks.deliver?.(held.request);
  }
}
