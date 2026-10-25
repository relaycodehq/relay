import type { ProjectChat } from "../../shared/projects";
import { noteForAgent } from "../../shared/thread-notes";
import type { ProjectChats } from "../project-chats";
import { toolText, type RelayToolArgs } from "../relay-mcp";
import { refused, type Approvals } from "./approvals";
import { drivenThread } from "./driven-thread";
import { leadSide } from "./lead-side";
import type { ProjectAccess } from "./project-access";
import type { ThreadReads } from "./thread-reads";
import { head, json } from "./tool-output";

/** The notes kept in threads: the lead's own, or one it may drive. */
export class NoteTools {
  constructor(
    private chats: Pick<ProjectChats, "get" | "notes">,
    private reads: Pick<ThreadReads, "children" | "thread">,
    private projects: Pick<ProjectAccess, "real">,
    private approvals: Approvals,
  ) {}

  async listNotes(lead: ProjectChat, { thread }: RelayToolArgs<"list_notes">) {
    const chat = await this.notesOf(lead, thread);
    const notes = await this.chats.notes.list(chat.id);
    return json({
      ...(chat.id === lead.id ? {} : { thread: chat.title }),
      notes: notes.map(noteForAgent),
    });
  }

  async addNote(
    lead: ProjectChat,
    { text, thread }: RelayToolArgs<"add_note">,
    signal: AbortSignal,
  ) {
    const chat = await this.notesToChange(
      lead,
      thread,
      "Keep a note in",
      head(text),
      signal,
    );
    if (!chat) return refused("keep this there");
    const note = await this.chats.notes.add(chat.id, {
      text,
      by: leadSide(lead).agent,
    });
    return toolText(
      `Kept as ${note.id}${chat.id === lead.id ? "" : ` in “${chat.title}”`}.`,
    );
  }

  async tickNote(
    lead: ProjectChat,
    { note, item, done = true, thread }: RelayToolArgs<"tick_note">,
    signal: AbortSignal,
  ) {
    const chat = await this.notesToChange(
      lead,
      thread,
      `${done ? "Tick" : "Untick"} item ${item} of ${note} in`,
      "",
      signal,
    );
    if (!chat) return refused(`${done ? "tick" : "untick"} it`);
    await this.chats.notes.tick(chat.id, note, item, done);
    return toolText(`${done ? "Ticked" : "Unticked"} ${note} item ${item}.`);
  }

  /** The thread whose notes a call means: the one named, or the caller's own. */
  private async notesOf(lead: ProjectChat, thread?: string) {
    if (!thread || thread === lead.id) return lead;
    return this.chats.get(thread).catch(() => {
      throw new Error("There's no such thread; see find_threads.");
    });
  }

  /**
   * The thread whose notes a change goes into. Another thread's take the same
   * leave as driving it: what is kept there is the first thing read_thread
   * hands any agent reading it.
   */
  private async notesToChange(
    lead: ProjectChat,
    thread: string | undefined,
    what: string,
    detail: string,
    signal: AbortSignal,
  ) {
    if (!thread || thread === lead.id) return lead;
    if (lead.startedBy)
      throw new Error(
        "A thread started by another thread keeps notes only in its own.",
      );
    const { chat, startedByLead, where } = await drivenThread(
      this.reads,
      this.projects,
      lead,
      thread,
    );
    if (
      !startedByLead &&
      !(await this.approvals.askToDrive(
        lead,
        `${what} “${chat.title}”${where}?`,
        detail,
        signal,
      ))
    )
      return undefined;
    return chat;
  }
}
