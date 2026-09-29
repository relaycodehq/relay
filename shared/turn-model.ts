import type { AgentDefaults, AgentModel, AgentProvider } from "./agents";
import type { InteractionMode } from "./agent-modes";
import {
  claudeArgs,
  claudeContextWindow,
  effortLabels,
  type ModelChoice,
  withClaudeContextWindow,
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
  /** Codex's Fast service tier. */
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
  // Claude ids may carry the `[1m]` window suffix; the list names each model once.
  const bare = (model: string) =>
    claude ? withClaudeContextWindow(model, "200k") : model;
  const listed = models.find((m) => bare(m.id) === bare(id));
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
    ...(provider === "codex" && input.choice.fast ? { fast: true } : {}),
    ...(claude && input.contextWindow === "200k"
      ? { window: "200k" as const }
      : claude && claudeContextWindow(picked) === "1m"
        ? { window: "1M" as const }
        : {}),
    ...(input.interactionMode === "plan" ? { plan: true } : {}),
  };
}

/** "Opus 5.5 · High effort · 1M context", with Default spelled out where it applied. */
export function turnModelLabel(
  provider: AgentProvider,
  model: TurnModel,
): string {
  const name = model.byDefault
    ? model.name
      ? `${model.name} (default)`
      : "Default model"
    : model.name;
  const level = provider === "codex" ? "reasoning" : "effort";
  const effort = model.effort
    ? `${effortLabels[model.effort]} ${level}${model.effortByDefault ? " (default)" : ""}`
    : `Default ${level}`;
  return [
    name,
    effort,
    model.fast && "Fast",
    model.window && `${model.window} context`,
    model.plan && "Plan mode",
  ]
    .filter(Boolean)
    .join(" · ");
}
