import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export function ComposerSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  container,
}: {
  label: string;
  value: T;
  options: {
    value: T;
    label: string;
    description?: string;
    icon?: ReactNode;
  }[];
  onChange: (value: T) => void;
  icon?: ReactNode;
  /** Portal target, needed inside a modal <dialog>'s top layer. */
  container?: HTMLElement;
}) {
  return (
    <Select.Root
      value={value}
      items={options}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <Select.Trigger
        type="button"
        aria-label={label}
        className="composer-control"
      >
        {icon}
        <Select.Value />
        <ChevronDown size={12} />
      </Select.Trigger>
      <Select.Portal container={container}>
        <Select.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
          alignItemWithTrigger={false}
          positionMethod={container ? "fixed" : "absolute"}
        >
          <Select.Popup
            className={`composer-select-popup ${options.some((o) => o.description) ? "composer-runtime-popup" : ""}`}
            aria-label={label}
          >
            <Select.List>
              {options.map((option) => (
                <Select.Item
                  className="composer-select-item"
                  key={option.value}
                  value={option.value}
                >
                  <span className="composer-option-content">
                    <span className="composer-option-label">
                      {option.icon}
                      <Select.ItemText>{option.label}</Select.ItemText>
                    </span>
                    {option.description && <small>{option.description}</small>}
                  </span>
                  {!option.description && (
                    <Select.ItemIndicator>
                      <Check size={13} />
                    </Select.ItemIndicator>
                  )}
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
