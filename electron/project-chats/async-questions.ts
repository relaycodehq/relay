import { randomUUID } from "node:crypto";
import {
  agentResponseSchema,
  type AgentResponse,
} from "../../shared/agent-modes";
import type { AgentProvider } from "../../shared/agents";
import type { ChatMessage, ProjectChatSend } from "../../shared/projects";
import { agentAsked } from "../../shared/recipient";
import type { ChatCore } from "./core";
import { assertHere } from "./handoff";
import { sessionInput } from "./sessions";

/**
 * A new turn typed to the agent answers its open questions in that
 * conversation, so they stop asking for input. They fold away dismissed,
 * so they can still be reopened and answered. Returns the messages it changed.
 */
export function supersedeQuestions(
  messages: ChatMessage[],
  provider: AgentProvider,
  parentId: string | null | undefined,
) {
  return messages.filter((m) => {
    if (
      m.role !== "assistant" ||
      m.provider !== provider ||
      (m.parentId ?? null) !== (parentId ?? null)
    )
      return false;
    const open = (m.questions ?? []).filter((g) => !g.answers && !g.dismissed);
    for (const group of open) group.dismissed = true;
    if (open.length) m.version++;
    return open.length > 0;
  });
}

/** Answers message-based questions through the active turn, or a normal follow-up. */
export class AsyncQuestions {
  constructor(
    private core: ChatCore,
    /** Sends while already holding the thread's control. */
    private send: (id: string, input: ProjectChatSend) => Promise<void>,
  ) {}

  answer(id: string, messageId: string, itemId: string, value: AgentResponse) {
    return this.core.control(id, async () => {
      const { chat, message, group } = await this.question(
        id,
        messageId,
        itemId,
      );
      const response = agentResponseSchema.parse(value);
      if (response.kind !== "question")
        throw new Error("Invalid response type.");
      if (
        Object.keys(response.answers).some(
          (key) => !group.questions.some((q) => q.id === key),
        )
      )
        throw new Error("Unknown question.");
      if (
        group.questions.some(
          (q) => !response.answers[q.id]?.some((a) => a.trim()),
        )
      )
        throw new Error("Answer each question before sending.");
      const body =
        "Answer to your questions:\n" +
        group.questions
          .map((q) => `${q.question}\n${response.answers[q.id].join("\n")}`)
          .join("\n\n");
      if (body.length > 32000)
        throw new Error(
          "These answers are too long. Shorten them before sending.",
        );
      await this.core.active.finished(id);
      const active = this.core.active.get(id);
      if (
        active?.steer &&
        !active.stopping &&
        active.input &&
        agentAsked(active.input)?.provider === message.provider &&
        (active.input.parentId ?? null) === (message.parentId ?? null)
      ) {
        const sent: ChatMessage = {
          id: randomUUID(),
          role: "user",
          provider: message.provider,
          body,
          status: "complete",
          created: Date.now(),
          version: 1,
          steered: true,
          asyncQuestionAnswer: true,
          unread: true,
          ...(message.parentId ? { parentId: message.parentId } : {}),
        };
        // In the transcript before Codex echoes the steer it read.
        chat.messages.push(sent);
        try {
          await this.core.storage.save(chat);
          await active.steer(body, sent.id);
        } catch (error) {
          chat.messages.splice(chat.messages.indexOf(sent), 1);
          await this.core.storage.save(chat);
          throw error;
        }
        this.core.emit({ chatId: id, message: structuredClone(sent) });
      } else {
        await this.send(id, {
          ...sessionInput(
            chat,
            message.provider,
            this.core.store,
            message.parentId ?? undefined,
          ),
          body,
        });
      }
      group.answers = response.answers;
      delete group.dismissed;
      message.version++;
      this.core.emit({ chatId: id, message: structuredClone(message) });
      await this.core.storage.save(chat);
    });
  }

  setDismissed(
    id: string,
    messageId: string,
    itemId: string,
    dismissed: boolean,
  ) {
    return this.core.control(id, async () => {
      const { chat, message, group } = await this.question(
        id,
        messageId,
        itemId,
      );
      if (!!group.dismissed === dismissed) return;
      const before = group.dismissed;
      if (dismissed) group.dismissed = true;
      else delete group.dismissed;
      message.version++;
      try {
        await this.core.storage.save(chat);
      } catch (error) {
        if (before) group.dismissed = before;
        else delete group.dismissed;
        message.version++;
        throw error;
      }
      this.core.emit({ chatId: id, message: structuredClone(message) });
    });
  }

  private async question(id: string, messageId: string, itemId: string) {
    if (this.core.closing()) throw new Error("Relay is closing.");
    const chat = await this.core.storage.load(id);
    assertHere(chat);
    const message = chat.messages.find((m) => m.id === messageId);
    const group = message?.questions?.find((q) => q.id === itemId);
    if (!message || message.role !== "assistant" || !group)
      throw new Error("This question is no longer available.");
    if (group.answers)
      throw new Error("This question has already been answered.");
    return { chat, message, group };
  }
}
