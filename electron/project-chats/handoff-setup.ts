import type { ThreadSetup } from "../../shared/handoff";
import type { ChatMessage, KnownMessages } from "../../shared/projects";
import type { ChatCore } from "./core";

/** Saves of a streaming setup message wait this long; what's in memory is current. */
const saveMs = 1000;

/**
 * On the computer a thread is handed from: how the computer it's going to
 * is readied for it (`ProjectChat.setup`), the setup agent's thread there
 * mirrored into it as it's written.
 */
export class SetupMirror {
  private saves = new Map<string, NodeJS.Timeout>();
  constructor(private core: ChatCore) {}

  /** A clone there starts; a setup already under way for that computer carries on. */
  async begin(id: string, computer: string, project: string) {
    const chat = await this.core.storage.load(id);
    const { setup } = chat;
    if (
      setup?.computer === computer &&
      (setup.state === "cloning" || setup.state === "agent")
    )
      return;
    chat.setup = {
      computer,
      after: chat.messages.length,
      at: Date.now(),
      state: "cloning",
      project,
      messages: [],
    };
    await this.saveNow(id);
  }

  async update(id: string, change: Partial<Omit<ThreadSetup, "messages">>) {
    const chat = await this.core.storage.load(id);
    if (!chat.setup) return;
    // Only one under way can be dropped; one that ended stays as it ended.
    if (
      change.state === "dropped" &&
      chat.setup.state !== "cloning" &&
      chat.setup.state !== "agent"
    )
      return;
    chat.setup = { ...chat.setup, ...change };
    await this.saveNow(id);
  }

  /** The setup's messages held, by version, so a reconnect sends only what changed. */
  async held(id: string): Promise<KnownMessages> {
    const chat = await this.core.storage.load(id);
    return Object.fromEntries(
      (chat.setup?.messages ?? []).map((m) => [m.id, m.version]),
    );
  }

  /** A message written in the setup's thread there: added, or in place of the copy held. */
  async mirror(id: string, message: ChatMessage) {
    const chat = await this.core.storage.load(id);
    const setup = chat.setup;
    if (setup?.state !== "agent") return;
    const at = setup.messages.findIndex((m) => m.id === message.id);
    if (at >= 0) setup.messages[at] = message;
    else setup.messages.push(message);
    this.core.emit({
      chatId: id,
      message: structuredClone(message),
      setup: true,
    });
    if (message.status === "streaming") this.saveSoon(id);
    else await this.saveNow(id);
  }

  /** The setup's thread as written there after a reconnect, those already held named by id. */
  async synced(id: string, messages: (ChatMessage | string)[]) {
    const chat = await this.core.storage.load(id);
    const setup = chat.setup;
    if (setup?.state !== "agent") return;
    const held = new Map(setup.messages.map((m) => [m.id, m]));
    const next = messages.flatMap((m) => {
      const known = held.get(typeof m === "string" ? m : m.id);
      if (typeof m === "string") return known ? [known] : [];
      return known && known.version > m.version ? [known] : [m];
    });
    const changed = next.filter((m) => held.get(m.id) !== m);
    const before = setup.messages.length;
    setup.messages = next;
    if (!changed.length && next.length === before) return;
    await this.saveNow(id);
    for (const m of changed)
      this.core.emit({ chatId: id, message: structuredClone(m), setup: true });
  }

  private saveSoon(id: string) {
    if (this.saves.has(id)) return;
    this.saves.set(
      id,
      setTimeout(() => void this.saveNow(id), saveMs),
    );
  }

  private async saveNow(id: string) {
    clearTimeout(this.saves.get(id));
    this.saves.delete(id);
    const chat = await this.core.storage.load(id);
    await this.core.storage
      .save(chat)
      .catch((e) => console.warn("A thread's setup wasn't saved:", e));
    this.core.storage.chatChanged(id);
  }

  dispose() {
    for (const timer of this.saves.values()) clearTimeout(timer);
    this.saves.clear();
  }
}
