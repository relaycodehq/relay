import {
  Bot,
  PencilRuler,
  LockKeyhole,
  LockKeyholeOpen,
  PencilLine,
  Sparkles,
} from "lucide-react";
import {
  runtimeModes,
  type RuntimeMode,
  type InteractionMode,
} from "../../shared/agent-modes";
import { ComposerSelect } from "./ComposerSelect";
const icons = {
  "approval-required": LockKeyhole,
  "auto-accept-edits": PencilLine,
  auto: Sparkles,
  "full-access": LockKeyholeOpen,
};
// T3's ComposerFooterModeControls: permissions and planning are independent.
export function ComposerModeControls({
  runtimeMode,
  interactionMode,
  onRuntimeMode,
  onInteractionMode,
}: {
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  onRuntimeMode: (mode: RuntimeMode) => void;
  onInteractionMode: (mode: InteractionMode) => void;
}) {
  const Icon = icons[runtimeMode];
  return (
    <>
      <span className="composer-divider" aria-hidden />
      <ComposerSelect
        label="Runtime mode"
        value={runtimeMode}
        icon={<Icon size={14} />}
        onChange={onRuntimeMode}
        options={runtimeModes.map((option) => {
          const OptionIcon = icons[option.value];
          return { ...option, icon: <OptionIcon size={14} /> };
        })}
      />
      <span className="composer-divider" aria-hidden />
      <button
        type="button"
        className={`composer-control composer-interaction ${interactionMode === "plan" ? "selected" : ""}`}
        aria-label={
          interactionMode === "plan"
            ? "Plan mode — click to return to normal build mode"
            : "Default mode — click to enter plan mode"
        }
        aria-pressed={interactionMode === "plan"}
        title={
          interactionMode === "plan"
            ? "Plan mode — click to return to normal build mode"
            : "Default mode — click to enter plan mode"
        }
        onClick={() =>
          onInteractionMode(interactionMode === "plan" ? "default" : "plan")
        }
      >
        {interactionMode === "plan" ? (
          <PencilRuler size={14} />
        ) : (
          <Bot size={16} />
        )}
        {interactionMode === "plan" ? "Plan" : "Build"}
      </button>
    </>
  );
}
