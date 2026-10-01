import type { ProjectChatsEvent } from "../shared/events";
import type { ChatSummary } from "../shared/projects";

/**
 * Pushes a project's thread list when it reads differently, so the sidebar
 * and phones don't poll for it. Changes are gathered for `delayMs`: a turn
 * starting saves its message, claims the thread and asks for a title at once.
 */
export class ChatSummaryFeed {
  private due = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  /** What each project's list last went out as. */
  private sent = new Map<string, string>();
  constructor(
    private list: (projectId: string) => ChatSummary[],
    private send: (event: ProjectChatsEvent) => void,
    private delayMs = 50,
  ) {}
  changed(projectId: string) {
    this.due.add(projectId);
    this.timer ??= setTimeout(() => this.flush(), this.delayMs);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const due = [...this.due];
    this.due.clear();
    for (const projectId of due) {
      let chats: ChatSummary[];
      try {
        chats = this.list(projectId);
      } catch {
        continue;
      }
      const signature = JSON.stringify(chats);
      if (this.sent.get(projectId) === signature) continue;
      this.sent.set(projectId, signature);
      this.send({ projectId, chats });
    }
  }
  dispose() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.due.clear();
  }
}
