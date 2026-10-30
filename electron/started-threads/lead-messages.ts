// What a started thread says to the thread that started it, its lead: a
// message it sends with message_lead, and the end of a task the lead gave it,
// which Relay hands back unless a wait_for_threads of the lead's hears of it.
// A side conversation tells its own thread something the same way, with
// message_main.
import { sliceWhole } from "../../shared/truncate";
import { agentError } from "../../shared/agent-error";
import type { ChildSays, ProjectChat } from "../../shared/projects";
import type { Turn } from "../../shared/turns";
import type { ProjectChats } from "../project-chats";
import { toolText } from "../relay-mcp";
import type { ThreadReads } from "./thread-reads";

/** How much of a finished answer the lead is handed; read_thread has the rest. */
export const REPORT_CHARS = 4000;

/** Who a message says it's from, as a thread's agent. */
export interface Sender {
  id: string;
  name: string;
  /** It's a thread the recipient started; see ChildSays. */
  child?: ChildSays;
}

/** How a message to the lead went out. */
export interface Delivered {
  /** It reached the lead mid-answer. */
  steered: boolean;
  /** The lead waits on the user, so it waits its turn in the queue. */
  queued: boolean;
  /** The other computer the lead runs on, when it does. */
  away?: string;
}

/** Sends `body` to `lead` from `from`: a steer while it works, otherwise a turn of its own. */
export type SendToLead = (
  lead: ProjectChat,
  body: string,
  from: Sender,
) => Promise<Delivered>;

/** The main conversation's messages. */
const main = (chat: ProjectChat) => chat.messages.filter((m) => !m.parentId);

/** Whether the message the thread's last answer replied to came from `lead`. */
export function answeredLead(chat: ProjectChat, lead: string) {
  const messages = main(chat);
  let at = messages.length;
  while (at-- > 0 && messages[at]!.role !== "assistant");
  while (at-- > 0 && messages[at]!.role !== "user");
  return at >= 0 && messages[at]!.fromThread === lead;
}

export class LeadMessages {
  constructor(
    private chats: Pick<ProjectChats, "get">,
    private reads: Pick<ThreadReads, "waitsFor" | "messaged">,
    private send: SendToLead,
    private sender: (chat: ProjectChat) => Sender,
  ) {}

  /** message_lead, called by the agent in `caller`. */
  async message(caller: ProjectChat, text: string) {
    const lead = await this.leadOf(caller);
    if (!lead)
      return toolText(
        caller.startedBy
          ? "The thread that started this one is gone; tell the user here instead."
          : "No thread started this one; tell the user here instead.",
        true,
      );
    const how = await this.tell(lead, caller, "message", [
      `From “${caller.title}” (thread ${caller.id}), a thread you started:`,
      text,
    ]);
    return toolText(
      how.away
        ? `Sent; your lead runs on ${how.away}.`
        : how.steered
          ? "Sent; your lead reads it mid-answer."
          : how.queued
            ? "Queued; your lead waits on the user and reads it after."
            : "Sent; your lead reads it in a new turn.",
    );
  }

  /** message_main, called by a side conversation of `thread`. */
  async fromSide(thread: ProjectChat, text: string) {
    const how = await this.send(
      thread,
      ["From a side conversation of this thread:", text].join("\n\n"),
      { id: thread.id, name: "Side conversation" },
    );
    return toolText(mainHeard(how));
  }

  /** A thread's turn ended. If another thread started it, tell that one how it went. */
  async ended(turn: Turn) {
    const thread = await this.chats.get(turn.threadId).catch(() => undefined);
    const parentId = thread?.startedBy?.chatId;
    if (!thread || !parentId) return; // no thread to report to
    if (!this.parentShouldHear(thread, parentId, turn)) return;
    const parent = await this.leadOf(thread);
    if (!parent || parent.settledAt) return; // gone, or the user put it away
    const report = endReport(thread, turn);
    await this.tell(parent, thread, report.child, report.parts);
  }

  private parentShouldHear(thread: ProjectChat, parentId: string, turn: Turn) {
    // When someone pressed Stop, they know already.
    const endedOnItsOwn =
      turn.endedAs === "completed" || turn.endedAs === "failed";
    // Reviewers report through their deep review.
    const isReviewer = !!thread.reviewer;
    // Not when it was answering something the user typed into it.
    const workedForParent = answeredLead(thread, parentId);
    // The parent's wait_for_threads returns the result itself.
    const parentWaiting = this.reads.waitsFor(parentId, thread.id);
    return endedOnItsOwn && !isReviewer && workedForParent && !parentWaiting;
  }

  private async leadOf(chat: ProjectChat) {
    if (!chat.startedBy || chat.reviewer) return undefined;
    const lead = await this.chats
      .get(chat.startedBy.chatId)
      .catch(() => undefined);
    return lead && !lead.archivedAt ? lead : undefined;
  }

  /** `parts` opens with the agent's line saying who wrote it, which the thread shows as a frame. */
  private async tell(
    lead: ProjectChat,
    from: ProjectChat,
    child: ChildSays,
    parts: [string, string],
  ) {
    const how = await this.send(lead, parts.join("\n\n"), {
      ...this.sender(from),
      child,
    });
    this.reads.messaged(lead.id, from.id);
    return how;
  }
}

/** How the main thread got a side conversation's message, for the side to say. */
function mainHeard(how: Delivered) {
  if (how.away) return `Sent; the thread runs on ${how.away}.`;
  if (how.steered) return "Sent; the main thread reads it mid-answer.";
  if (how.queued)
    return "Queued; the main thread waits on the user and reads it after.";
  return "Sent; the main thread reads it in a new turn.";
}

/**
 * What the lead is told of a task that ended: the agent's line saying so,
 * then the answer or why it failed.
 */
export function endReport(
  chat: ProjectChat,
  turn: Pick<Turn, "endedAs">,
): { child: ChildSays; parts: [string, string] } {
  const answer = main(chat)
    .filter((m) => m.role === "assistant")
    .at(-1);
  const where = `“${chat.title}” (thread ${chat.id}), a thread you started,`;
  if (turn.endedAs === "failed")
    return {
      child: "failed",
      parts: [
        `${where} failed:`,
        answer?.error?.trim()
          ? agentError(answer.error).message
          : "Its answer failed.",
      ],
    };
  const body = answer?.body.trim() ?? "";
  if (!body)
    return {
      child: "finished",
      parts: [`${where} finished:`, "It ended without a word."],
    };
  if (body.length <= REPORT_CHARS)
    return { child: "finished", parts: [`${where} finished:`, body] };
  return {
    child: "finished",
    parts: [
      `${where} finished. Here's the start of its answer; read_thread has the rest:`,
      `${sliceWhole(body, 0, REPORT_CHARS)}…`,
    ],
  };
}
