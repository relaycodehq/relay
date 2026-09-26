import type { RuntimeMode } from "../../../shared/agent-modes";
import type { ReasoningEffort } from "../../../shared/settings";

// shared/agent-modes' runtimeModes; that module brings zod, which the phone doesn't bundle.
export const runtimeModes: {
  value: RuntimeMode;
  label: string;
  description: string;
}[] = [
  {
    value: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
  },
  {
    value: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
  },
  {
    value: "auto",
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
  },
];

export const modeLabel = (mode: RuntimeMode) =>
  runtimeModes.find((m) => m.value === mode)?.label ?? mode;

const effortLabels: Record<ReasoningEffort, string> = {
  "": "Default",
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};
export const effortLabel = (effort: ReasoningEffort) => effortLabels[effort] ?? effort;
