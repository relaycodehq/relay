import { runtimeModes, type RuntimeMode } from "../../../shared/agent-modes";
import { effortLabels, type ReasoningEffort } from "../../../shared/settings";

export { runtimeModes };

export const modeLabel = (mode: RuntimeMode) =>
  runtimeModes.find((m) => m.value === mode)?.label ?? mode;

export const effortLabel = (effort: ReasoningEffort) =>
  effort === "" ? "Default" : (effortLabels[effort] ?? effort);
