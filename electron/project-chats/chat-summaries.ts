import { createHash } from "node:crypto";
import type { ProjectChatsEvent } from "../../shared/events";
import type {
  ChatSummary,
  ProjectChat,
  ScheduledChatMessage,
} from "../../shared/projects";
import { contextAgent } from "../../shared/recipient";
import { notesMark } from "../../shared/thread-notes";
import { reviewSummary } from "./review-summary";

/** The earliest scheduled message still waiting to go out on its own. */
export function nextSend(scheduled: ScheduledChatMessage[] = []) {
  const times = scheduled.filter((s) => !s.error).map((s) => s.at);
  return times.length ? Math.min(...times) : undefined;
}

/** A short mark of what waits in the thread's queue and Send later list; none when nothing does. */
export function queueMark({
  queue,
  queuePaused,
  scheduled,
}: Pick<ProjectChat, "queue" | "queuePaused" | "scheduled">) {
  if (!queue?.length && !scheduled?.length) return undefined;
  const waiting = JSON.stringify([
    (queue ?? []).map((q) => [q.input.id, q.error ?? ""]),
    !!queuePaused,
    (scheduled ?? []).map((s) => [s.input.id, s.at, s.error ?? ""]),
  ]);
  return createHash("sha1").update(waiting).digest("base64url").slice(0, 10);
}

/** A question the agent asked in the thread is still open. */
export const asksYou = (messages: ProjectChat["messages"]) =>
  messages.some((m) =>
    m.questions?.some((group) => !group.answers && !group.dismissed),
  );

/** What the sidebar lists of a thread: everything but its conversation and the state behind it. */
export function chatSummary({
  messages,
  requests,
  queue,
  queuePaused,
  scheduled,
  lastInput,
  sessions,
  forkedAt,
  replySessions,
  checkoutNotes,
  scopeHeard,
  movedIn,
  setupNote,
  reviews,
  findings: _findings,
  handover,
  outbox,
  carriedIds,
  notes,
  setup,
  // Worked out below; a stale copy on the thread itself doesn't count.
  queueMark: _staleMark,
  notesMark: _staleNotesMark,
  setupMark: _staleSetupMark,
  model: _staleModel,
  asking,
  ...summary
}: ProjectChat): ChatSummary {
  const latest = [...messages].reverse().find((m) => m.role === "assistant");
  const provider = latest?.provider;
  const model = latest?.model?.name;
  const holder = contextAgent(messages.filter((m) => !m.parentId));
  const providers = [
    ...new Set(
      [...messages]
        .reverse()
        .flatMap((m) =>
          m.role === "assistant" && m.provider ? [m.provider] : [],
        ),
    ),
  ];
  const next = nextSend(scheduled);
  const mark = queueMark({ queue, queuePaused, scheduled });
  const notesAt = notesMark(notes);
  const open = asksYou(messages);
  return {
    ...summary,
    providers,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(holder ? { contextAgent: holder } : {}),
    ...(next ? { nextSend: next } : {}),
    ...(mark ? { queueMark: mark } : {}),
    ...(notesAt ? { notesMark: notesAt } : {}),
    ...(setup ? { setupMark: `${setup.state}:${setup.at}` } : {}),
    ...(open ? { asking: true as const } : {}),
    ...reviewSummary(reviews),
    empty: !messages.length && !scheduled?.length,
  };
}

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
