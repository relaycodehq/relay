import { z } from "zod";
import {
  agentName,
  agentProviderSchema,
  helperProviderSchema,
  type AgentProvider,
  type HelperProvider,
} from "./agents";
export { helperProviderSchema, type HelperProvider };

export const modelSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/[\]@~+-]*$/, "Enter a valid model ID.");
export const reasoningEffortSchema = z.enum([
  "",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export const effortLabels: Record<ReasoningEffort, string> = {
  "": "Codex default",
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};
/** A Codex model, as the signed-in `codex app-server` lists it. */
export type CodexModel = {
  id: string;
  name: string;
  description: string;
  efforts: ReasoningEffort[];
  /** Codex suggests moving from it to a newer model. */
  legacy: boolean;
  /** The effort it runs when none is set. */
  defaultEffort?: ReasoningEffort;
  /** The model Codex runs when its config names none. */
  isDefault?: boolean;
};
const commonEfforts: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const preset = (
  id: string,
  name: string,
  efforts: ReasoningEffort[],
  legacy = false,
): CodexModel => ({ id, name, description: "", efforts, legacy });
/** Offered until Codex lists its models, and whenever it can't. */
export const fallbackCodexModels: CodexModel[] = [
  preset("gpt-6-astra", "GPT-6-Astra", [...commonEfforts, "max", "ultra"]),
  preset("gpt-6-sol", "GPT-6-Sol", [...commonEfforts, "max", "ultra"]),
  preset("gpt-6-luna", "GPT-6-Luna", [...commonEfforts, "max"]),
  preset("gpt-5.6-sol", "GPT-5.6-Sol", [...commonEfforts, "max", "ultra"]),
  preset("gpt-5.6-terra", "GPT-5.6-Terra", [...commonEfforts, "max", "ultra"]),
  preset("gpt-5.6-luna", "GPT-5.6-Luna", [...commonEfforts, "max"]),
  preset("gpt-5.5", "GPT-5.5", commonEfforts, true),
];
export type ClaudeModel = {
  id: string;
  name: string;
  description: string;
  efforts: ReasoningEffort[];
  /** Whether the model also runs with a 1M-token context window. */
  longContext: boolean;
  /** The model id an alias stands for, e.g. `claude-opus-5-5` for `opus`. */
  resolved?: string;
};
/** Claude Code switches to the 1M context window with a `[1m]` model suffix. */
export type ClaudeContextWindow = "200k" | "1m";
export const claudeContextWindow = (model: string): ClaudeContextWindow =>
  model.endsWith("[1m]") ? "1m" : "200k";
export const withClaudeContextWindow = (
  model: string,
  contextWindow: ClaudeContextWindow,
) => model.replace(/\[1m\]$/, "") + (contextWindow === "1m" ? "[1m]" : "");
/** The listed model an id refers to, whichever context window it asks for. */
export const findClaudeModel = (
  models: ClaudeModel[] | undefined,
  id: string,
) =>
  models?.find(
    (m) =>
      withClaudeContextWindow(m.id, "200k") ===
      withClaudeContextWindow(id, "200k"),
  );
/** Levels accepted by `claude --effort` and the Agent SDK. */
export const claudeEfforts: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
/** A model the CLI didn't list (custom, or the list failed) offers every level. */
export const claudeEffortsFor = (
  models: ClaudeModel[] | undefined,
  id: string,
) => findClaudeModel(models, id)?.efforts ?? claudeEfforts;
/** Only efforts Claude accepts; Codex-only levels fall back to its default. */
export const claudeArgs = (choice: {
  model: string;
  reasoningEffort: ReasoningEffort;
}) => ({
  model: choice.model,
  effort: claudeEfforts.includes(choice.reasoningEffort)
    ? choice.reasoningEffort
    : "",
});
/** A model Codex didn't list (custom, or the list failed) offers every level. */
export const reasoningEffortsFor = (
  model: string,
  listed: CodexModel[] = fallbackCodexModels,
): ReasoningEffort[] =>
  (
    listed.find((m) => m.id === model) ??
    fallbackCodexModels.find((m) => m.id === model)
  )?.efforts ?? reasoningEffortSchema.options.filter((e) => e !== "");
export const supportsEffort = (
  choice: { model: string; reasoningEffort: ReasoningEffort },
  listed?: CodexModel[],
) =>
  !choice.reasoningEffort ||
  reasoningEffortsFor(choice.model, listed).includes(choice.reasoningEffort);
/** The choice as its model takes it: an effort the model lacks becomes its default. */
export const supportedChoice = <
  T extends { model: string; reasoningEffort: ReasoningEffort },
>(
  choice: T,
  listed?: CodexModel[],
): T =>
  supportsEffort(choice, listed) ? choice : { ...choice, reasoningEffort: "" };
const choiceSchema = z
  .object({
    model: modelSchema,
    fast: z.boolean(),
    // Before this setting existed, grouping always used medium reasoning.
    reasoningEffort: reasoningEffortSchema.default("medium"),
  })
  .strict();
const effortCheck = {
  message: "Choose a reasoning effort supported by this model.",
  path: ["reasoningEffort"],
};
export const modelChoiceSchema = choiceSchema.refine(
  (choice) => supportsEffort(choice),
  effortCheck,
);
const questionChoiceSchema = choiceSchema
  .extend({
    model: z.union([modelSchema, z.literal("")]),
    // Existing question sessions inherited the user's CLI reasoning setting.
    reasoningEffort: reasoningEffortSchema.default(""),
  })
  .refine((choice) => supportsEffort(choice), effortCheck);
const claudeEffortCheck = (
  provider: AgentProvider,
  choice: { reasoningEffort: ReasoningEffort },
) =>
  provider !== "claude" ||
  !choice.reasoningEffort ||
  claudeEfforts.includes(choice.reasoningEffort);
// Settings saved before Claude was offered used Codex for both.
export const aiSettingsSchema = z
  .object({
    grouping: modelChoiceSchema,
    questions: questionChoiceSchema,
    /** Splits local changes into commits; added later, so it has a default. */
    split: questionChoiceSchema.default({
      model: "",
      fast: false,
      reasoningEffort: "medium",
    }),
    /** Which signed-in CLI runs grouping, line questions or commit splits. */
    groupingProvider: helperProviderSchema.default("codex"),
    questionsProvider: helperProviderSchema.default("codex"),
    /** Commit splits only need text back, so any agent can plan them. */
    splitProvider: agentProviderSchema.default("codex"),
    /** The agent a composer starts on until it remembers one. */
    threadProvider: agentProviderSchema.default("codex"),
  })
  .strict()
  .refine((s) => claudeEffortCheck(s.groupingProvider, s.grouping), {
    ...effortCheck,
    path: ["grouping", "reasoningEffort"],
  })
  .refine((s) => claudeEffortCheck(s.questionsProvider, s.questions), {
    ...effortCheck,
    path: ["questions", "reasoningEffort"],
  })
  .refine((s) => claudeEffortCheck(s.splitProvider, s.split), {
    ...effortCheck,
    path: ["split", "reasoningEffort"],
  });
export type ModelChoice = z.infer<typeof modelChoiceSchema>;
export type AISettings = z.infer<typeof aiSettingsSchema>;
/** As persisted, possibly from before a field existed; parse before use. */
export type StoredAISettings = z.input<typeof aiSettingsSchema>;
export const defaultAISettings: AISettings = {
  grouping: { model: "gpt-5.6-luna", fast: false, reasoningEffort: "medium" },
  questions: { model: "", fast: false, reasoningEffort: "" },
  split: { model: "", fast: false, reasoningEffort: "medium" },
  groupingProvider: "codex",
  questionsProvider: "codex",
  splitProvider: "codex",
  threadProvider: "codex",
};
/** Codex's line-question choice, or its defaults when questions go to Claude. */
export const codexQuestionChoice = (settings: AISettings): ModelChoice =>
  settings.questionsProvider === "codex"
    ? settings.questions
    : defaultAISettings.questions;
const modelChoices = [
  ["gpt-5.6-luna", "Luna"],
  ["gpt-5.6-sol", "Sol"],
  ["gpt-5.6-terra", "Terra"],
  ["gpt-6-astra", "Astra"],
  ["gpt-5.5", "GPT-5.5"],
] as const;
export const modelName = (id: string) =>
  modelChoices.find(([value]) => value === id)?.[1] ?? (id || "Codex default");
export const choiceLabel = (
  choice: ModelChoice,
  provider: AgentProvider = "codex",
) =>
  provider !== "codex"
    ? `${agentName(provider)} · ${choice.model || "default model"}${choice.reasoningEffort ? ` · ${effortLabels[choice.reasoningEffort]} effort` : ""}`
    : `${modelName(choice.model)}${choice.reasoningEffort ? ` · ${effortLabels[choice.reasoningEffort]} reasoning` : ""} · ${choice.fast ? "Fast" : "Standard"}`;

/** Explicit standard overrides any Fast preference inherited from Codex config. */
export const codexModelArgs = (choice: ModelChoice): string[] => [
  ...(choice.model ? ["--model", choice.model] : []),
  ...(choice.reasoningEffort
    ? ["-c", `model_reasoning_effort="${choice.reasoningEffort}"`]
    : []),
  "-c",
  `service_tier="${choice.fast ? "fast" : "default"}"`,
  "-c",
  "features.fast_mode=true",
];
