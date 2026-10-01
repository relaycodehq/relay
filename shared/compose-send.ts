import { agentMentionPattern, agents, type AgentProvider } from "./agents";
import type { ProjectChatSend } from "./projects";
import { claudeContextWindow, type ModelChoice } from "./settings";
import type { UltraplanKind } from "./ultraplan";

/** A message as a composer hands it on, before it gets its id. */
export type ComposedSend = Omit<ProjectChatSend, "id">;

/** What a composer sends with, once the agent's model is picked. */
export interface SendSettings {
  /** The agent that answers; "message" is a note no agent answers. */
  to: AgentProvider | "message";
  choice: ModelChoice;
  contextWindow?: ProjectChatSend["contextWindow"];
  runtimeMode: ProjectChatSend["runtimeMode"];
  interactionMode: ProjectChatSend["interactionMode"];
}

export interface SendOptions {
  /** A council plans this one question, in Plan mode. */
  council?: UltraplanKind;
  /** An answer is running: the message waits for it, or steers it. */
  running?: { steer: boolean };
  sendAt?: number;
  /** `/btw`: a side question the main session never hears. */
  side?: boolean;
  parentId?: string;
  images?: NonNullable<ProjectChatSend["images"]>;
}

/** A message as every composer sends it, desktop and phone alike. */
export function buildSend(
  { to, choice, contextWindow, runtimeMode, interactionMode }: SendSettings,
  text: string,
  options: SendOptions = {},
): ComposedSend {
  const body = text.trim();
  const { council, running, sendAt } = options;
  // Agents without Fast send it off; a model with 1M built in asks for nothing.
  const fast = to === "message" || agents[to].fast ? choice.fast : false;
  const window =
    to === "claude" &&
    contextWindow &&
    claudeContextWindow(choice.model) !== "1m"
      ? { contextWindow }
      : {};
  return {
    ...(sendAt
      ? { sendAt }
      : running
        ? {
            delivery:
              running.steer && !council
                ? ("steer" as const)
                : ("queue" as const),
          }
        : {}),
    body:
      to === "message" || agentMentionPattern.test(body)
        ? body
        : `@${to} ${body}`.trim(),
    // A note goes in as Codex's; no agent answers it.
    provider: to === "message" ? "codex" : to,
    choice: { ...choice, fast },
    ...window,
    runtimeMode,
    interactionMode: council ? "plan" : interactionMode,
    ...(council ? { ultraplan: council } : {}),
    ...(options.side ? { side: true } : {}),
    ...(options.parentId ? { parentId: options.parentId } : {}),
    ...(options.images?.length ? { images: options.images } : {}),
  };
}

/** What a composer sends to carry out a proposed plan. */
export const implementPlan = (provider: AgentProvider) =>
  `@${provider} Implement the plan from your previous response.`;
