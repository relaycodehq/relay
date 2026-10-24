import { randomUUID } from "node:crypto";
import type { ProjectChatSend } from "../../shared/projects";
import {
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
  pastesRoot,
  readPaste,
  writePasteChunk,
  savePaste,
  setPastesRoot,
  sweepPastes,
} from "./pastes";
export { writeUploadChunk } from "./uploads";

/** How long a phone's send waits on the desktop's page; the phone gives a send two minutes. */
const heldSendMs = 110_000;

/**
 * The computer's drafts, shared by its windows and phones (see
 * shared/drafts), and the phone sends that need the desktop's composer: a
 * draft with a screenshot or code reference in it goes out from the page
 * that holds them.
 */
export class Drafts {
  private held = new Map<
    string,
    { request: HeldSend; done: (result: HeldSendResult) => void }
  >();
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

  /** Forgets the drafts of threads that are gone. */
  remove(keys: Iterable<string>) {
    for (const change of this.store.remove(keys)) this.hooks.changed(change);
  }

  /** Whether a phone's send of the draft must go through the desktop's page, which holds part of it. */
  holds(key: string) {
    return !!this.hooks.deliver && hasExtras(this.store.get(key)?.extras);
  }

  /** Sends the phone's message with what the desktop's page holds of the draft; the thread it went to. */
  sendHeld(
    key: string,
    chatId: string | undefined,
    send: ProjectChatSend,
  ): Promise<{ chatId: string }> {
    const request: HeldSend = {
      id: randomUUID(),
      key,
      ...(chatId ? { chatId } : {}),
      send,
    };
    // The version that went: a phone may type the next message before this one is out.
    const base = this.store.get(key)?.rev ?? 0;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          finish({
            error: "Relay on the computer didn't get to send it in time.",
          }),
        heldSendMs,
      );
      const finish = (result: HeldSendResult) => {
        clearTimeout(timer);
        this.held.delete(request.id);
        if ("error" in result) reject(new Error(result.error));
        else {
          // What went out goes from the draft, and with it the desktop's part;
          // anything written after it was sent stays.
          if (this.store.get(key))
            this.write(
              { key, text: "", base, at: Date.now(), sent: send.body },
              "desktop",
            );
          resolve(result);
        }
      };
      this.held.set(request.id, { request, done: finish });
      if (!this.hooks.deliver?.(request))
        finish({ error: "Open Relay on the computer to send this draft." });
    });
  }

  /** Sends still waiting on a page, for one that just loaded. */
  waitingSends(): HeldSend[] {
    return [...this.held.values()].map((h) => h.request);
  }

  finishSend(id: string, result: HeldSendResult) {
    this.held.get(id)?.done(result);
  }

  /** The page that had them went: they go to the next one. */
  redeliver() {
    for (const { request } of this.held.values()) this.hooks.deliver?.(request);
  }
}
