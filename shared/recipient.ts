import { agentMentionPattern, type AgentProvider } from "./agents";
import type { ChatMessage, ChatSummary, ProjectChatSend } from "./projects";
import { agentMention } from "./rooms";

/** Who a message goes to: an agent, or "message", a note no agent answers. */
export type Recipient = AgentProvider | "message";

/**
 * Who answers a sent message. Its `to` says; a message without one, from an
 * older phone or desktop or a queue saved before it, goes to the agent its
 * body starts with a mention of, and is a note without one.
 */
export const recipient = (send: Pick<ProjectChatSend, "body" | "to">) =>
  send.to ?? agentMention(send.body)?.provider ?? "message";

/** The agent that answers a sent message and what it's asked; null for a note. */
export function agentAsked(
  send: Pick<ProjectChatSend, "body" | "to">,
): { provider: AgentProvider; question: string } | null {
  const to = recipient(send);
  return to === "message"
    ? null
    : {
        provider: to,
        question: send.body.trim().replace(agentMentionPattern, "").trim(),
      };
}

/** The agent a message went to; for a note, the one its settings are for. */
export function sentAgent(
  send: Pick<ProjectChatSend, "body" | "to" | "provider">,
): AgentProvider {
  const to = recipient(send);
  return to === "message" ? send.provider : to;
}

/** Who a draft goes to: the agent it starts with a mention of, else the one picked. */
export const draftRecipient = (text: string, picked: Recipient): Recipient =>
  agentMention(text)?.provider ?? picked;

/**
 * The agent holding a conversation's working context: the last one to answer
 * in it. Compactions and handoff notes don't count, nor a side conversation's
 * root (`rootId`), which belongs to the main session. Taking over from it
 * loses its session.
 */
export const contextAgent = (
  conversation: ChatMessage[],
  rootId?: string,
): AgentProvider | undefined =>
  [...conversation]
    .reverse()
    .find(
      (m) =>
        m.role === "assistant" &&
        !m.compaction &&
        !m.handoff &&
        !m.reload &&
        !m.worktreeCommand &&
        m.id !== rootId,
    )?.provider;

/**
 * Whether sending to `to` makes another agent take over from `holder`, the
 * one holding the context. A note, an unheld context or the holder itself
 * takes nothing over.
 */
export const takesOver = (
  to: Recipient | undefined,
  holder: AgentProvider | undefined,
): to is AgentProvider => !!to && to !== "message" && !!holder && to !== holder;

/** A thread's main `contextAgent`; summaries saved before it was kept have only their latest answer's. */
export const threadContextAgent = (
  chat: Pick<ChatSummary, "contextAgent" | "provider">,
) => chat.contextAgent ?? chat.provider;
