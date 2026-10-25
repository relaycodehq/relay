import { agentName } from "../../shared/agents";
import type { ProjectChat, ProjectChatSend } from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import type { ModelChoice } from "../../shared/settings";

/** The choice a thread runs on before anyone picked one: the agent's own defaults. */
export const defaultChoice: ModelChoice = {
  model: "",
  fast: false,
  reasoningEffort: "",
};
const fallbackInput = {
  provider: "claude",
  choice: defaultChoice,
  runtimeMode: "approval-required",
  interactionMode: "default",
} satisfies Partial<ProjectChatSend>;

/** What `chat` last ran on; Relay's defaults for one that hasn't run yet. */
export const lastSend = (chat: ProjectChat) =>
  chat.lastInput ?? { ...fallbackInput, body: "", id: chat.id };

/** Who the lead's messages say they're from, and on what it last ran. */
export function leadSide(lead: ProjectChat) {
  const last = lastSend(lead);
  const agent = sentAgent(last);
  return {
    last,
    agent,
    from: {
      id: lead.id,
      name: `${agentName(agent)} in ${lead.title}`.slice(0, 300),
    },
  };
}
