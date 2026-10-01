import { agentMentionPattern, type AgentProvider } from "./agents";
import type { ProjectChatSend } from "./projects";
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
