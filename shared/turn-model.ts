import {
  type AgentDefaults,
  type AgentModel,
  type AgentProvider,
} from "./agents";
import { fastFor, listedModel } from "./model-fit";
import type { InteractionMode } from "./agent-modes";
import {
  claudeArgs,
  claudeContextWindow,
  effortLabels,
  type ModelChoice,
  type ReasoningEffort,
} from "./settings";

/** What an answer ran on, resolved when its turn started. */
export interface TurnModel {
  /** The model's listed name, its id when unlisted; "" when Default's is unknown. */
  name: string;
  /** The model was left on the agent's Default. */
  byDefault?: boolean;
  /** "" when Default's level is unknown. */
  effort: ReasoningEffort;
  effortByDefault?: boolean;
  /** The Fast service tier, for agents that have one. */
  fast?: boolean;
  /** Claude's context window, when the thread picked one. */
  window?: "200k" | "1M";
  plan?: boolean;
}

export function resolveTurnModel(
  provider: AgentProvider,
  input: {
    choice: ModelChoice;
    contextWindow?: "200k";
    interactionMode?: InteractionMode;
  },
  models: AgentModel[],
  defaults: AgentDefaults | null,
): TurnModel {
  const claude = provider === "claude";
  const picked = input.choice.model;
  const id = picked || defaults?.model || "";
  const listed = listedModel(provider, models, id);
  const chosen = claude
    ? claudeArgs(input.choice).effort
    : input.choice.reasoningEffort;
  const effort =
    chosen ||
    (picked
      ? (defaults?.efforts?.[listed?.id ?? picked] ?? "")
      : (defaults?.effort ?? ""));
  return {
    name: listed?.name ?? id,
    ...(picked ? {} : { byDefault: true }),
    effort,
    ...(chosen ? {} : { effortByDefault: true }),
    ...(fastFor(provider, input.choice.fast) ? { fast: true } : {}),
    ...(claude && input.contextWindow === "200k"
      ? { window: "200k" as const }
      : claude && claudeContextWindow(picked) === "1m"
        ? { window: "1M" as const }
        : {}),
    ...(input.interactionMode === "plan" ? { plan: true } : {}),
  };
}

/** "Opus 5.5 Medium"; "" when neither is known. */
export function turnModelLabel(model: TurnModel): string {
  return [model.name, model.effort && effortLabels[model.effort]]
    .filter(Boolean)
    .join(" ");
}
