import { agents, type AgentProvider } from "./agents";
import type { NewThreadModel } from "./new-thread-models";
import {
  claudeContextWindow,
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
