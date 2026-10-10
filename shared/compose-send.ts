import { agentMentionPattern, type AgentProvider } from "./agents";
import { fastFor, windowFor } from "./model-fit";
import type { ProjectChatSend } from "./projects";
import { draftRecipient, type Recipient } from "./recipient";
import type { ModelChoice } from "./settings";

/** A message as a composer hands it on, before it gets its id. */
export type ComposedSend = Omit<ProjectChatSend, "id">;

/** What a composer sends with, once the agent's model is picked. */
export interface SendSettings {
  /** The agent that answers, unless the text names another; "message" is a note no agent answers. */
  to: Recipient;
  choice: ModelChoice;
  contextWindow?: ProjectChatSend["contextWindow"];
  runtimeMode: ProjectChatSend["runtimeMode"];
  interactionMode: ProjectChatSend["interactionMode"];
}

export interface SendOptions {
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
  settings: SendSettings,
  text: string,
  options: SendOptions = {},
): ComposedSend {
  const body = text.trim();
  const to = draftRecipient(body, settings.to);
  const { runtimeMode, interactionMode } = settings;
  // Another agent named in the text runs on its Default: the picked model is
  // the picked agent's.
  const picked = to === settings.to;
  const choice: ModelChoice = picked
    ? settings.choice
    : { model: "", reasoningEffort: "", fast: false };
  const contextWindow = picked ? settings.contextWindow : undefined;
  // A note to people keeps the choice as picked; nobody runs it.
  const fast = to === "message" ? choice.fast : fastFor(to, choice.fast);
  return {
    ...whenSent(options),
    // Desktops before `to` read who answers from the mention, so it stays.
    body:
      to === "message" || agentMentionPattern.test(body)
        ? body
        : `@${to} ${body}`.trim(),
    to,
    // Older desktops require an agent even on a note, which none answers.
    provider: to === "message" ? "codex" : to,
    choice: { ...choice, fast },
    ...windowFor(to, choice.model, contextWindow),
    runtimeMode,
    interactionMode,
    ...(options.side ? { side: true } : {}),
    ...(options.parentId ? { parentId: options.parentId } : {}),
    ...(options.images?.length ? { images: options.images } : {}),
  };
}

/**
 * When the message goes: at `sendAt`, or beside the running answer, steering
 * it.
 */
function whenSent({
  sendAt,
  running,
}: SendOptions): Pick<ComposedSend, "sendAt" | "delivery"> {
  if (sendAt) return { sendAt };
  if (!running) return {};
  return { delivery: running.steer ? "steer" : "queue" };
}

/** What a composer sends to carry out a proposed plan. */
export const implementPlan = (provider: AgentProvider) =>
  `@${provider} Implement the plan from your previous response.`;

/**
 * The go-ahead for the plan `planner` proposed, and the settings a composer
 * keeps afterwards: on that agent, in Build. A composer on another agent
 * hands over to the planner on its Default model, since the model it holds
 * belongs to the other one.
 */
export function planGoAhead(
  settings: SendSettings,
  planner: AgentProvider,
): {
  send: ComposedSend;
  nextSettings: SendSettings & { to: AgentProvider };
} {
  const { contextWindow, ...rest } = settings;
  const byDefault: ModelChoice = {
    model: "",
    reasoningEffort: "",
    fast: false,
  };
  const onPlanner: Omit<SendSettings, "to"> =
    settings.to === planner
      ? { ...rest, ...(contextWindow ? { contextWindow } : {}) }
      : { ...rest, choice: byDefault };
  const nextSettings = {
    ...onPlanner,
    to: planner,
    interactionMode: "default" as const,
  };
  return {
    send: buildSend(nextSettings, implementPlan(planner)),
    nextSettings,
  };
}
