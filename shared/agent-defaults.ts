import { z } from "zod";
import {
  effortLabels,
  findClaudeModel,
  withClaudeContextWindow,
  type ClaudeModel,
  type CodexModel,
  type ReasoningEffort,
} from "./settings";
import type { AgentDefaults } from "./agents";

/**
 * What Claude Code runs where Relay leaves the model or effort on Default,
 * as its settings files and built-in defaults decide.
 */
export type ClaudeDefaults = {
  /** The settings' `model`; "" leaves Claude Code's built-in one. */
  model: string;
  /** The model the session runs now, by canonical id. */
  appliedModel: string;
  /** The effort it runs now; "" when it sends none. */
  appliedEffort: ReasoningEffort;
  /** The settings' `effortLevel`, for models without one of their own. */
  effortLevel: ReasoningEffort;
  /** The settings' per-model `effortLevel`s, by canonical id. */
  modelEfforts: Record<string, ReasoningEffort>;
};
const level = z
  .enum(["low", "medium", "high", "xhigh", "max"])
  .nullish()
  .catch(undefined);
const modelId = z.string().max(200).nullish().catch(undefined);
const claudeSettingsSchema = z.object({
  effective: z.object({
    model: modelId,
    effortLevel: level,
    modelSettings: z
      .record(z.string().max(200), z.object({ effortLevel: level }).catch({}))
      .nullish()
      .catch(undefined),
  }),
  applied: z.object({ model: modelId, effort: level }),
});
/** Reads what the SDK's `getSettings()` answers; undefined if it can't. */
export function claudeDefaultsFrom(value: unknown): ClaudeDefaults | undefined {
  const parsed = claudeSettingsSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { effective, applied } = parsed.data;
  return {
    model: effective.model ?? "",
    appliedModel: applied.model ?? "",
    appliedEffort: applied.effort ?? "",
    effortLevel: effective.effortLevel ?? "",
    modelEfforts: Object.fromEntries(
      Object.entries(effective.modelSettings ?? {}).flatMap(([id, s]) =>
        s.effortLevel
          ? [[withClaudeContextWindow(id, "200k"), s.effortLevel]]
          : [],
      ),
    ),
  };
}
/** The effort the settings give a model, by canonical id; "" leaves its built-in one. */
export const settingsEffort = (
  defaults: ClaudeDefaults,
  model: string,
): ReasoningEffort =>
  defaults.modelEfforts[withClaudeContextWindow(model, "200k")] ??
  defaults.effortLevel;
/** What Default effort runs on `model` ("" for Default's); "" when unknown. */
export function claudeDefaultEffort(
  defaults: ClaudeDefaults | undefined,
  model: string,
  models: ClaudeModel[] | undefined,
): ReasoningEffort {
  if (!defaults) return "";
  if (!model) return defaults.appliedEffort;
  const listed = findClaudeModel(models, model);
  const effort = settingsEffort(defaults, listed?.resolved ?? model);
  return !listed || listed.efforts.includes(effort) ? effort : "";
}

/** What Codex runs where Relay leaves the model or effort on Default, as its config decides. */
export type CodexDefaults = {
  /** The config's `model`; "" runs the model Codex lists as its default. */
  model: string;
  /** The config's `model_reasoning_effort`; "" runs each model's own. */
  effort: ReasoningEffort;
};
const codexDefaultModel = (
  defaults: CodexDefaults | undefined,
  models: CodexModel[],
) => (defaults ? defaults.model || models.find((m) => m.isDefault)?.id : "");
/** What Default effort runs on `model` ("" for Default's); "" when unknown. */
export function codexDefaultEffort(
  defaults: CodexDefaults | undefined,
  model: string,
  models: CodexModel[],
): ReasoningEffort {
  if (!defaults) return "";
  if (defaults.effort) return defaults.effort;
  const id = model || codexDefaultModel(defaults, models);
  return models.find((m) => m.id === id)?.defaultEffort ?? "";
}

/** "Default (Medium)", or plain "Default" when its level isn't known. */
export const defaultEffortLabel = (effort: ReasoningEffort) =>
  effort ? `Default (${effortLabels[effort]})` : "Default";

/** Codex's Default as every agent reports it: listed model, effort, per-model efforts. */
export function codexAgentDefaults(
  defaults: CodexDefaults,
  models: CodexModel[],
): AgentDefaults {
  return {
    model: codexDefaultModel(defaults, models) ?? "",
    effort: codexDefaultEffort(defaults, "", models),
    efforts: Object.fromEntries(
      models.map((m) => [m.id, codexDefaultEffort(defaults, m.id, models)]),
    ),
  };
}
/** Claude's Default as every agent reports it: listed model, effort, per-model efforts. */
export function claudeAgentDefaults(
  defaults: ClaudeDefaults,
  models: ClaudeModel[],
): AgentDefaults {
  return {
    model: findClaudeModel(models, defaults.appliedModel)?.id ?? "",
    effort: claudeDefaultEffort(defaults, "", models),
    efforts: Object.fromEntries(
      models.map((m) => [m.id, claudeDefaultEffort(defaults, m.id, models)]),
    ),
  };
}
