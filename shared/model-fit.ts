import { agents, type AgentModel, type AgentProvider } from "./agents";
import type { NewThreadModel } from "./new-thread-models";
import {
  claudeContextWindow,
  findClaudeModel,
  withClaudeContextWindow,
  type ModelChoice,
  type ReasoningEffort,
} from "./settings";

// What an agent runs on, fitted to what it offers. Every composer, picker
// and send goes through these, so an agent's new quirk changes them alone.

/** Fast stays on only for agents that have it. */
export const fastFor = (provider: AgentProvider, fast: boolean) =>
  agents[provider].fast && fast;

/** The 200k window is Claude's, and a model with 1M built in asks for none. */
export const windowFor = (
  provider: string,
  model: string,
  contextWindow: NewThreadModel["contextWindow"],
): Pick<NewThreadModel, "contextWindow"> =>
  provider === "claude" && contextWindow && claudeContextWindow(model) !== "1m"
    ? { contextWindow }
    : {};

/** `model` with only what `provider` offers. */
export const fitModel = (
  provider: AgentProvider,
  { choice, contextWindow }: NewThreadModel,
): NewThreadModel => ({
  choice: { ...choice, fast: fastFor(provider, choice.fast) },
  ...windowFor(provider, choice.model, contextWindow),
});

/** `choice` moved to `model`, which takes `efforts`: one it lacks goes back to Default. */
export const onModel = (
  provider: AgentProvider,
  choice: ModelChoice,
  model: string,
  efforts: readonly ReasoningEffort[],
): ModelChoice => ({
  model,
  reasoningEffort: efforts.includes(choice.reasoningEffort)
    ? choice.reasoningEffort
    : "",
  fast: fastFor(provider, choice.fast),
});

/** The model `id` is in `models`, however the agent spells it. */
export const listedModel = <M extends Pick<AgentModel, "id" | "resolved">>(
  provider: string,
  models: readonly M[] | undefined,
  id: string,
): M | undefined =>
  provider === "claude"
    ? findClaudeModel(models, id)
    : models?.find((m) => m.id === id);

/** What every picker calls `id`: its listed name, else the id itself. */
export const modelName = (
  provider: string,
  models: readonly Pick<AgentModel, "id" | "name" | "resolved">[] | undefined,
  id: string,
) => listedModel(provider, models, id)?.name ?? id;

/**
 * Claude on the 200k or 1M window. 200k drops the `[1m]` suffix, which would
 * override it; 1M gives a picked model the suffix, which accounts without 1M
 * by default still need, and leaves Default on Claude's own window.
 */
export function onWindow<T extends NewThreadModel>(
  model: T,
  size: "200k" | "1m",
): T {
  const { choice, contextWindow: _, ...rest } = model;
  return size === "200k"
    ? {
        ...model,
        choice: {
          ...choice,
          model: withClaudeContextWindow(choice.model, "200k"),
        },
        contextWindow: "200k",
      }
    : ({
        ...rest,
        choice: {
          ...choice,
          model: choice.model && withClaudeContextWindow(choice.model, "1m"),
        },
      } as T);
}
