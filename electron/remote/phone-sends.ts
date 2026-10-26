// A phone's sends go in once each, though a reconnect may retry one before
// the first finished, and a phone reading the thread back learns whether its
// send arrived.
import type { ProjectChatPatch } from "../../shared/projects";

const sendKey = (chatId: string, id: string) => JSON.stringify([chatId, id]);

export class PhoneSends {
  // Kept across phone reconnects, until dispatch finishes (which may be making a worktree).
  private running = new Map<string, Promise<unknown>>();
  // A taken-back queue item no longer holds its id. Its lost answer still counts as a receipt.
  private accepted = new Map<string, unknown>();

  /** `went` hears of each send that went in. */
  constructor(private went: () => void) {}

  /**
   * A send, once per id: a reconnect may retry before worktree creation
   * finishes, and both await the same one; once it's in, a retry is a no-op
   * that still counts as a receipt.
   */
  async once<T>(chatId: string, id: string, run: () => Promise<T>) {
    const key = sendKey(chatId, id);
    if (this.accepted.has(key)) return this.accepted.get(key) as T;
    let job = this.running.get(key);
    if (!job) {
      job = run();
      this.running.set(key, job);
    }
    try {
      const value = await job;
      this.accepted.set(key, value);
      this.went();
      return value as T;
    } finally {
      if (this.running.get(key) === job) this.running.delete(key);
    }
  }

  /** The send is still being dispatched. */
  dispatching(chatId: string, sendId: string) {
    return this.running.has(sendKey(chatId, sendId));
  }

  /**
   * Whether the phone's send `sendId` reached the thread: still being
   * dispatched, or in its messages, queue or schedule. A queued message the
   * user took back no longer carries its id, so accepted sends count too.
   * `dispatchedBefore` is asked before the thread was read, since a send that
   * lands while it's read may be missing from what was read.
   */
  receipt(patch: ProjectChatPatch, sendId: string, dispatchedBefore: boolean) {
    const dispatching = dispatchedBefore || this.dispatching(patch.id, sendId);
    const accepted = this.accepted.has(sendKey(patch.id, sendId));
    const inMessages = patch.messages.some(
      (m) => (typeof m === "string" ? m : m.id) === sendId,
    );
    const queued = !!patch.queue?.some((q) => q.input.id === sendId);
    const scheduled = !!patch.scheduled?.some((s) => s.input.id === sendId);
    return {
      sendPending: dispatching,
      hasSend: dispatching || accepted || inMessages || queued || scheduled,
    };
  }
}
