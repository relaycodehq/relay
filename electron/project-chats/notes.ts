import {
  addNote,
  removeNote,
  tickNote,
  type NewNote,
  type ThreadNote,
} from "../../shared/thread-notes";
import type { ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";

/** What the user keeps at hand in a thread, saved with it; see shared/thread-notes. */
export class ThreadNotes {
  constructor(private core: ChatCore) {}

  async list(id: string): Promise<ThreadNote[]> {
    return structuredClone((await this.core.storage.load(id)).notes ?? []);
  }

  async add(id: string, input: NewNote) {
    const chat = await this.core.storage.load(id);
    if (input.from && !chat.messages.some((m) => m.id === input.from))
      throw new Error("That message isn't in the thread.");
    const { notes, note } = addNote(chat.notes, input);
    if (notes !== chat.notes) await this.write(chat, notes);
    return structuredClone(note);
  }

  async tick(id: string, note: string, item: number, done: boolean) {
    const chat = await this.core.storage.load(id);
    return this.write(chat, tickNote(chat.notes, note, item, done));
  }

  async remove(id: string, note: string) {
    const chat = await this.core.storage.load(id);
    return this.write(chat, removeNote(chat.notes, note));
  }

  /** The kept notes of `from` for a fork, pointing at the fork's copies of their messages. */
  static forFork(
    notes: ThreadNote[] | undefined,
    ids: Map<string, string>,
  ): ThreadNote[] | undefined {
    if (!notes?.length) return undefined;
    return notes.map(({ from, ...note }) => {
      const copy = from && ids.get(from);
      return { ...structuredClone(note), ...(copy ? { from: copy } : {}) };
    });
  }

  /** `chat` is the one cached copy, so a turn saving it meanwhile keeps these too. */
  private async write(chat: ProjectChat, notes: ThreadNote[]) {
    if (notes.length) chat.notes = notes;
    else delete chat.notes;
    await this.core.storage.save(chat);
    return structuredClone(notes);
  }
}
