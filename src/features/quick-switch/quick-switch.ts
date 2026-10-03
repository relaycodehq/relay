import { persistedStore } from "../../lib/persisted-store";
import { z } from "zod";
import {
  agentName,
  agents,
  agentProviderSchema,
  type AgentProvider,
} from "../../../shared/agents";
import { fastFor } from "../../../shared/model-fit";
import {
  effortLabels,
  reasoningEffortSchema,
  type ReasoningEffort,
} from "../../../shared/settings";

/**
 * Quick switch: agent, model and effort presets that ⌃⌘←/→ steps through in
 * the composer; effort keeps ⌘⌥←/→. A per-device preference like the send
 * key, so it lives in localStorage rather than settings.
 */
export const quickSwitchStyles = [
  "drum",
  "list",
  "track",
  "dock",
  "tab",
  "revolver",
] as const;
export type QuickSwitchStyle = (typeof quickSwitchStyles)[number];

const presetSchema = z.object({
  id: z.string().min(1).max(40),
  provider: agentProviderSchema,
  /** "" runs the agent's default model. */
  model: z.string().trim().max(160),
  reasoningEffort: reasoningEffortSchema,
  /** The Fast service tier, for agents that have one. */
  fast: z.boolean().catch(false),
});
export type QuickPreset = z.infer<typeof presetSchema>;

export const maxPresets = 12;
const quickSwitchSchema = z.object({
  enabled: z.boolean().catch(true),
  style: z.enum(quickSwitchStyles).catch("drum"),
  /** The revolver clicks as it turns. */
  sound: z.boolean().catch(true),
  presets: z.array(presetSchema).max(maxPresets).catch([]),
});
export type QuickSwitch = z.infer<typeof quickSwitchSchema>;

const fallback: QuickSwitch = {
  enabled: true,
  style: "drum",
  sound: true,
  presets: [],
};

export function parseQuickSwitch(value: unknown): QuickSwitch {
  const parsed = quickSwitchSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

const quickSwitch = persistedStore<QuickSwitch>(
  "relay-quick-switch",
  (saved) => (saved ? parseQuickSwitch(JSON.parse(saved)) : fallback),
  (value) => JSON.stringify(value),
);
export const setQuickSwitch = quickSwitch.set;
export const useQuickSwitch = quickSwitch.use;

export const newPresetId = () => Math.random().toString(36).slice(2, 10);

/** A preset as the switcher shows it. */
export interface QuickItem {
  id: string;
  provider: AgentProvider;
  name: string;
  effort: string;
  fast: boolean;
}

/** Presets by their listed model names; an unlisted model shows its id. */
export const quickItems = (
  presets: QuickPreset[],
  modelsOf: (p: AgentProvider) => { id: string; name: string }[] | undefined,
): QuickItem[] =>
  presets.map((p) => ({
    id: p.id,
    provider: p.provider,
    name: p.model
      ? (modelsOf(p.provider)?.find((m) => m.id === p.model)?.name ?? p.model)
      : `${agentName(p.provider)} default`,
    effort: p.reasoningEffort ? effortLabels[p.reasoningEffort] : "Default",
    fast: fastFor(p.provider, p.fast),
  }));

/** What the composer runs now, in a preset's terms. */
export interface ComposerRun {
  provider: AgentProvider;
  model: string;
  reasoningEffort: ReasoningEffort;
  fast: boolean;
}

const sameModel = (p: QuickPreset, run: ComposerRun) =>
  p.provider === run.provider && p.model === run.model;

/**
 * Which preset the composer is on, or -1. An exact match wins; then `last`,
 * the preset last stepped to, while its agent and model still run (an effort
 * the model lacks falls back to default); then any preset of the same model.
 */
export function presetIndex(
  presets: QuickPreset[],
  run: ComposerRun,
  last = -1,
): number {
  const exact = presets.findIndex(
    (p) =>
      sameModel(p, run) &&
      p.reasoningEffort === run.reasoningEffort &&
      (!agents[p.provider].fast || p.fast === run.fast),
  );
  if (exact >= 0) return exact;
  if (presets[last] && sameModel(presets[last], run)) return last;
  return presets.findIndex((p) => sameModel(p, run));
}

/**
 * The preset one step from `at`. Off the list, → starts at the first and ←
 * at the last. Like effort, the ends stop there, unless `wrap` goes on round,
 * as the revolver does.
 */
export function stepPreset(
  count: number,
  at: number,
  step: -1 | 1,
  wrap = false,
): number {
  if (count <= 0) return -1;
  if (at < 0) return step > 0 ? 0 : count - 1;
  if (wrap) return (at + step + count) % count;
  return Math.min(count - 1, Math.max(0, at + step));
}
