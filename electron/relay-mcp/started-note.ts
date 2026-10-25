import { agentName, type AgentProvider } from "../../shared/agents";

/**
 * What a thread another thread started is told with each turn, privately:
 * who its lead is, that its answers go back there, and how to reach it.
 */
export function startedNote({
  lead,
  fromLead,
  canMessage,
}: {
  lead: { id: string; title: string; agent: AgentProvider };
  /** This turn's message came from the lead, not the user. */
  fromLead: boolean;
  /** It has Relay's tools, message_lead among them. */
  canMessage: boolean;
}) {
  return [
    `Another thread started this one: ${agentName(lead.agent)} in “${lead.title}” (thread ${lead.id}), your lead. The user sees this thread too and can write in it.`,
    fromLead
      ? "This message is from your lead, not the user. Relay hands your final answer to it when you finish, so end with what it needs: the result, where it is, and anything left open."
      : "The user wrote this message here themselves; answer them.",
    canMessage &&
      "To reach your lead before you finish, with a question about the task, a blocker or a finding it needs now, use message_lead. When you can't go on without its reply, ask with message_lead and end your answer; the reply comes as your next message.",
  ]
    .filter(Boolean)
    .join(" ");
}
