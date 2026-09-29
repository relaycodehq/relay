import { memo, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  Bot,
  Check,
  ChevronDown,
  PencilRuler,
  LockKeyhole,
  LockKeyholeOpen,
  Orbit,
  PencilLine,
  Sparkles,
} from "lucide-react";
import {
  runtimeModesFor,
  type RuntimeMode,
  type InteractionMode,
} from "../../shared/agent-modes";
import type { AgentProvider } from "../../shared/agents";
import { ComposerSelect } from "./ComposerSelect";
const icons = {
  "approval-required": LockKeyhole,
  "auto-accept-edits": PencilLine,
  auto: Sparkles,
  "full-access": LockKeyholeOpen,
};
type Mode = InteractionMode | "ultraplan";
const modes: { value: Mode; label: string; hint: string; icon: ReactNode }[] = [
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
  {
    value: "ultraplan",
    label: "Ultraplan",
    hint: "a council thinks first",
    icon: <Orbit size={14} />,
  },
];
// T3's ComposerFooterModeControls: permissions and planning are independent.
export const ComposerModeControls = memo(function ComposerModeControls({
  provider,
  runtimeMode,
  interactionMode,
  ultraplan = false,
  onRuntimeMode,
  onInteractionMode,
  onUltraplan,
}: {
  /** The agent that will answer; how it honors each runtime mode differs. */
  provider?: AgentProvider;
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  ultraplan?: boolean;
  onRuntimeMode: (mode: RuntimeMode) => void;
  onInteractionMode: (mode: InteractionMode) => void;
  /** Unset where a council can't run, so the menu doesn't offer it. */
  onUltraplan?: (on: boolean) => void;
}) {
  const Icon = icons[runtimeMode];
  const mode: Mode = ultraplan ? "ultraplan" : interactionMode;
  const current = modes.find((m) => m.value === mode)!;
  return (
    <>
      <span className="composer-divider" aria-hidden />
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
      <span className="composer-divider" aria-hidden />
      <Menu.Root>
        <Menu.Trigger
          className={`composer-control composer-interaction ${mode !== "default" ? "selected" : ""}`}
          data-mode={mode}
          aria-label={`Mode: ${current.label}`}
          title="Build, plan, or plan with a council first"
        >
          {current.icon}
          <span className={mode === "ultraplan" ? "ultraplan-text" : undefined}>
            {current.label}
          </span>
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
              <Menu.RadioGroup
                value={mode}
                onValueChange={(value: Mode) => {
                  onInteractionMode(value === "default" ? "default" : "plan");
                  onUltraplan?.(value === "ultraplan");
                }}
              >
                {modes
                  .filter((m) => m.value !== "ultraplan" || onUltraplan)
                  .map((m) => (
                    <Menu.RadioItem
                      key={m.value}
                      className="composer-select-item"
                      value={m.value}
                      data-mode={m.value}
                      closeOnClick
                    >
                      <span className="composer-mode-option">
                        {m.icon}
                        <span
                          className={
                            m.value === "ultraplan"
                              ? "ultraplan-text"
                              : undefined
                          }
                        >
                          {m.label}
                        </span>
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
    </>
  );
});
