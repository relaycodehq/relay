import { memo, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  Bot,
  Check,
  ChevronDown,
  PencilRuler,
  LockKeyhole,
  LockKeyholeOpen,
  PencilLine,
  Sparkles,
} from "lucide-react";
import {
  runtimeModesFor,
  type RuntimeMode,
  type InteractionMode,
} from "../../../shared/agent-modes";
import type { AgentProvider } from "../../../shared/agents";
import { ComposerSelect } from "../../ui/ComposerSelect";
const icons = {
  "approval-required": LockKeyhole,
  "auto-accept-edits": PencilLine,
  auto: Sparkles,
  "full-access": LockKeyholeOpen,
};
const modes: {
  value: InteractionMode;
  label: string;
  hint: string;
  icon: ReactNode;
}[] = [
  {
    value: "default",
    label: "Build",
    hint: "edits files",
    icon: <Bot size={16} />,
  },
  {
    value: "plan",
    label: "Plan",
    hint: "no edits",
    icon: <PencilRuler size={14} />,
  },
];
// Permissions and planning are independent controls.
export const ComposerModeControls = memo(function ComposerModeControls({
  provider,
  runtimeMode,
  interactionMode,
  onRuntimeMode,
  onInteractionMode,
}: {
  /** The agent that will answer; how it honors each runtime mode differs. */
  provider?: AgentProvider;
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  onRuntimeMode: (mode: RuntimeMode) => void;
  onInteractionMode: (mode: InteractionMode) => void;
}) {
  return (
    <>
      <span className="composer-divider" aria-hidden />
      <RuntimeModeSelect
        provider={provider}
        runtimeMode={runtimeMode}
        onRuntimeMode={onRuntimeMode}
      />
      <span className="composer-divider" aria-hidden />
      <InteractionModeMenu
        interactionMode={interactionMode}
        onInteractionMode={onInteractionMode}
      />
    </>
  );
});

/** How much the agent may do without asking: approvals up to full access. */
export const RuntimeModeSelect = memo(function RuntimeModeSelect({
  provider,
  runtimeMode,
  onRuntimeMode,
}: {
  provider?: AgentProvider;
  runtimeMode: RuntimeMode;
  onRuntimeMode: (mode: RuntimeMode) => void;
}) {
  const Icon = icons[runtimeMode];
  return (
    <ComposerSelect
      label="Runtime mode"
      className="composer-runtime"
      value={runtimeMode}
      icon={<Icon size={14} />}
      onChange={onRuntimeMode}
      options={runtimeModesFor(provider).map((option) => {
        const OptionIcon = icons[option.value];
        return { ...option, icon: <OptionIcon size={14} /> };
      })}
    />
  );
});

/** Build or Plan. */
export const InteractionModeMenu = memo(function InteractionModeMenu({
  interactionMode,
  onInteractionMode,
}: {
  interactionMode: InteractionMode;
  onInteractionMode: (mode: InteractionMode) => void;
}) {
  const mode = interactionMode;
  const current = modes.find((m) => m.value === mode)!;
  return (
    <Menu.Root>
      <Menu.Trigger
        className={`composer-control composer-interaction ${mode !== "default" ? "selected" : ""}`}
        data-mode={mode}
        aria-label={`Mode: ${current.label}`}
        title="Build or plan"
      >
        {current.icon}
        <span>{current.label}</span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup
            className="composer-select-popup composer-mode-menu"
            aria-label="Mode"
          >
            <Menu.RadioGroup value={mode} onValueChange={onInteractionMode}>
              {modes.map((m) => (
                <Menu.RadioItem
                  key={m.value}
                  className="composer-select-item"
                  value={m.value}
                  data-mode={m.value}
                  closeOnClick
                >
                  <span className="composer-mode-option">
                    {m.icon}
                    <span>{m.label}</span>
                    <small>{m.hint}</small>
                  </span>
                  <Menu.RadioItemIndicator>
                    <Check size={13} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
});
