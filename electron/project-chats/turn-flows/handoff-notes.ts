import type {
  AgentProvider,
  ChatMessage,
  ProjectChat,
} from "../../../shared/projects";
import { agentName } from "../../../shared/agents";
import { streamingAnswer } from "../answer-recorder";
import type { ActiveChat } from "../active";
import type { ChatCore } from "../core";
import { relayNote } from "../relay-note";
import { sessionInput } from "../sessions";
import type { TurnRunner } from "../turn-run";

/** The outgoing agent gets this long to write its note before the switch goes ahead without one. */
const HANDOFF_TIMEOUT = 120000;
/** Asked of the agent whose session ends here, in that session, so it can draw on everything it did. */
const handoffPrompt = (to: AgentProvider, computer?: string) =>
  `${
    computer
      ? `This conversation moves to another computer, ${computer}, from here. ${agentName(to)} picks it up there in a fresh session that cannot see yours; everything in the working tree is committed and goes with it.`
      : `${agentName(to)} is taking over this conversation from here and cannot see your session.`
  } Write a handoff note for it: the user's goal, what you did (files read or changed, commands run), what you found, decisions and their reasons, and what remains or should be verified next. Use concrete file paths. Answer from what you already know without running tools or changing anything. Keep it under 500 words.`;

/**
 * Notes that brief the agent taking a thread over: one the outgoing agent
 * writes in its own session, or one Relay writes when it can't.
 */
export class TurnHandoffs {
  constructor(
    private core: ChatCore,
    private runner: TurnRunner,
  ) {}
  /**
   * Asks the agent that answered last to brief the one taking over. Best effort:
   * a failed or slow note leaves a marker and the switch proceeds without it.
   */
  async note(
    chat: ProjectChat,
    root: string,
    from: AgentProvider,
    to: AgentProvider,
    parentId: string | undefined,
    active: ActiveChat,
    computer?: string,
  ): Promise<ChatMessage> {
    const input = sessionInput(chat, from, this.core.store, parentId);
    const message = streamingAnswer(from, {
      handoff: { from, to, ...(computer ? { computer } : {}) },
      ...(parentId ? { parentId } : {}),
    });
    chat.messages.push(message);
    await this.core.storage.save(chat);
    this.core.emit({ chatId: chat.id, message: structuredClone(message) });
    const abort = new AbortController();
    const stop = () => abort.abort();
    active.abort.signal.addEventListener("abort", stop, { once: true });
    // A Stop during the save above has already fired.
    if (active.abort.signal.aborted) stop();
    const timer = setTimeout(stop, HANDOFF_TIMEOUT);
    const done = this.core.active.helper(
      chat.id,
      active,
      "handoff",
      from,
      message,
    );
    try {
      await this.runner.run(
        chat,
        message,
        root,
        handoffPrompt(to, computer),
        input,
        abort,
        { kind: "handoff" },
      );
    } finally {
      clearTimeout(timer);
      active.abort.signal.removeEventListener("abort", stop);
      done(abort.signal.aborted);
    }
    return message;
  }
  /**
   * The note Relay writes when the outgoing agent left none, in the place of
   * its failed one if it tried, so the thread shows what the new agent got.
   */
  async byRelay(
    chat: ProjectChat,
    failed: ChatMessage | undefined,
    from: AgentProvider,
    to: AgentProvider,
    parentId: string | undefined,
    conversation: ChatMessage[],
  ): Promise<ChatMessage> {
    const body = relayNote(conversation, from);
    const kept = failed && chat.messages.find((m) => m.id === failed.id);
    const message =
      kept ?? streamingAnswer(from, { ...(parentId ? { parentId } : {}) });
    Object.assign(message, {
      handoff: { from, to, byRelay: true },
      body,
      status: "complete",
      ended: Date.now(),
    });
    delete message.error;
    if (!kept) chat.messages.push(message);
    await this.core.storage.save(chat);
    this.core.emit({ chatId: chat.id, message: structuredClone(message) });
    return message;
  }
}
