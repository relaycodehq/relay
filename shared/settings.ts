import { z } from "zod";

export const modelSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]*$/, "Enter a valid model ID.");
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
// Preset capabilities verified against the signed-in Codex model catalog.
const commonEfforts: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const presetEfforts: Record<string, ReasoningEffort[]> = {
  "gpt-5.5": commonEfforts,
  "gpt-5.6-luna": [...commonEfforts, "max"],
  "gpt-5.6-sol": [...commonEfforts, "max", "ultra"],
  "gpt-5.6-terra": [...commonEfforts, "max", "ultra"],
  "gpt-6-astra": [...commonEfforts, "max", "ultra"],
};
export type ClaudeModel = {
  id: string;
  name: string;
  description: string;
  efforts: ReasoningEffort[];
};
/** Levels accepted by `claude --effort` and the Agent SDK. */
export const claudeEfforts: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
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
export const reasoningEffortsFor = (model: string): ReasoningEffort[] =>
  presetEfforts[model] ?? reasoningEffortSchema.options.filter((e) => e !== "");
export const supportsEffort = (choice: {
  model: string;
  reasoningEffort: ReasoningEffort;
}) =>
  !choice.reasoningEffort ||
  reasoningEffortsFor(choice.model).includes(choice.reasoningEffort);
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
  supportsEffort,
  effortCheck,
);
const questionChoiceSchema = choiceSchema
  .extend({
    model: z.union([modelSchema, z.literal("")]),
    // Existing question sessions inherited the user's CLI reasoning setting.
    reasoningEffort: reasoningEffortSchema.default(""),
  })
  .refine(supportsEffort, effortCheck);
export const aiSettingsSchema = z
  .object({ grouping: modelChoiceSchema, questions: questionChoiceSchema })
  .strict();
export type ModelChoice = z.infer<typeof modelChoiceSchema>;
export type AISettings = z.infer<typeof aiSettingsSchema>;
export const defaultAISettings: AISettings = {
  grouping: { model: "gpt-5.6-luna", fast: false, reasoningEffort: "medium" },
  questions: { model: "", fast: false, reasoningEffort: "" },
};
export const modelChoices = [
  ["gpt-5.6-luna", "Luna"],
  ["gpt-5.6-sol", "Sol"],
  ["gpt-5.6-terra", "Terra"],
  ["gpt-6-astra", "Astra"],
  ["gpt-5.5", "GPT-5.5"],
] as const;
export const modelName = (id: string) =>
  modelChoices.find(([value]) => value === id)?.[1] ?? (id || "Codex default");
export const choiceLabel = (choice: ModelChoice) =>
  `${modelName(choice.model)}${choice.reasoningEffort ? ` · ${effortLabels[choice.reasoningEffort]} reasoning` : ""} · ${choice.fast ? "Fast" : "Standard"}`;

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
