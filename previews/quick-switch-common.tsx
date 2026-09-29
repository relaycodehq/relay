// Sample presets and the pieces every quick-switch option shares.
import { Zap } from "lucide-react";
import { ProviderIcon } from "../src/components/ComposerModelPicker";
import type { AgentProvider } from "../shared/agents";
import { effortLabels, type ReasoningEffort } from "../shared/settings";

export type Preset = {
  id: string;
  provider: AgentProvider;
  model: string;
  effort: ReasoningEffort;
  fast?: boolean;
};

// Sample catalogs; the real ones come from each CLI's model list.
export const catalog: Record<
  AgentProvider,
  { models: { id: string; name: string }[]; efforts: ReasoningEffort[] }
> = {
  claude: {
    models: [
      { id: "claude-haiku-4-5", name: "Haiku 4.5" },
      { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
      { id: "claude-opus-5-5", name: "Opus 5.5" },
    ],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  codex: {
    models: [
      { id: "gpt-6-luna", name: "GPT-6 Luna" },
      { id: "gpt-6-sol", name: "GPT-6 Sol" },
      { id: "gpt-6-astra", name: "GPT-6 Astra" },
    ],
    efforts: ["minimal", "low", "medium", "high", "xhigh"],
  },
  opencode: {
    models: [
      { id: "moonshot/kimi-k2", name: "Kimi K2" },
      { id: "qwen/qwen3-coder", name: "Qwen3 Coder" },
      { id: "zai/glm-5", name: "GLM-5" },
    ],
    efforts: [],
  },
};

export const samplePresets: Preset[] = [
  { id: "a", provider: "claude", model: "claude-haiku-4-5", effort: "low" },
  { id: "b", provider: "claude", model: "claude-sonnet-5-5", effort: "medium" },
  { id: "c", provider: "claude", model: "claude-opus-5-5", effort: "max" },
  { id: "d", provider: "codex", model: "gpt-6-luna", effort: "medium" },
  { id: "e", provider: "codex", model: "gpt-6-astra", effort: "xhigh", fast: true },
  { id: "f", provider: "opencode", model: "moonshot/kimi-k2", effort: "" },
];

export const modelName = (p: Preset) =>
  catalog[p.provider].models.find((m) => m.id === p.model)?.name ?? p.model;
export const effortName = (p: Preset) =>
  p.effort ? effortLabels[p.effort] : "Default";
export const keysLabel = "⌘⌥ ←→";

/** Consecutive presets of one provider. */
export function groupsOf(presets: Preset[]) {
  const groups: { provider: AgentProvider; from: number; to: number }[] = [];
  presets.forEach((p, i) => {
    const last = groups.at(-1);
    if (last?.provider === p.provider) last.to = i;
    else groups.push({ provider: p.provider, from: i, to: i });
  });
  return groups;
}

export type HudProps = {
  presets: Preset[];
  index: number;
  dir: number;
  onPick: (i: number) => void;
};

/** Glyph, model and effort; remounts per preset so it slides in from the step's side. */
export function Current({ preset, dir }: { preset: Preset; dir: number }) {
  return (
    <span className="qs-current" key={preset.id} data-dir={dir < 0 ? "left" : "right"}>
      <ProviderIcon provider={preset.provider} />
      <span className="qs-current-model">{modelName(preset)}</span>
      <span className="qs-current-effort">{effortName(preset)}</span>
      {preset.fast && <Zap size={12} className="qs-fast" aria-label="Fast" />}
    </span>
  );
}
