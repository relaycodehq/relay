import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { Fragment, memo } from "react";
import { FitLabel } from "../../ui/ComposerSelect";

export type TraitSection = {
  label: string;
  /** Keys that change this without opening the menu. */
  hint?: string;
  value: string;
  options: { value: string; label: string; short?: string }[];
  onChange: (value: string) => void;
  /** An on/off choice under the options, like Claude's Ultrathink. */
  toggle?: TraitToggle;
};

type TraitToggle = {
  label: string;
  /** What it applies to, in muted text after the label. */
  note?: string;
  className?: string;
  checked: boolean;
  onChange: () => void;
};

/**
 * Related choices behind one trigger that names them all,
 * e.g. "High · 200k".
 */
export const ComposerTraitsMenu = memo(function ComposerTraitsMenu({
  label,
  sections,
}: {
  label: string;
  sections: TraitSection[];
}) {
  const [first, ...rest] = sections.flatMap((s) => {
    const picked = s.options.find((o) => o.value === s.value);
    return picked ? [picked] : [];
  });
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} className="composer-control">
        <span>
          {first && <FitLabel label={first.label} short={first.short} />}
          {rest.length > 0 && (
            <span className="fit-rest">
              {rest.map((option) => (
                <Fragment key={option.value}>
                  {" · "}
                  <FitLabel label={option.label} short={option.short} />
                </Fragment>
              ))}
            </span>
          )}
        </span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup className="composer-select-popup" aria-label={label}>
            {sections.map((section, index) => (
              <Fragment key={section.label}>
                {index > 0 && (
                  <Menu.Separator className="composer-menu-separator" />
                )}
                <Menu.Group>
                  <Menu.GroupLabel className="composer-menu-label">
                    {section.label}
                    {section.hint && <kbd>{section.hint}</kbd>}
                  </Menu.GroupLabel>
                  <Menu.RadioGroup
                    value={section.value}
                    onValueChange={section.onChange}
                  >
                    {section.options.map((option) => (
                      <Menu.RadioItem
                        className="composer-select-item"
                        key={option.value}
                        value={option.value}
                        closeOnClick
                      >
                        {option.label}
                        <Menu.RadioItemIndicator>
                          <Check size={13} />
                        </Menu.RadioItemIndicator>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                  {section.toggle && <ToggleItem toggle={section.toggle} />}
                </Menu.Group>
              </Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
});

function ToggleItem({ toggle }: { toggle: TraitToggle }) {
  return (
    <Menu.CheckboxItem
      className={`composer-select-item ${toggle.className ?? ""}`}
      checked={toggle.checked}
      onCheckedChange={toggle.onChange}
      closeOnClick
    >
      <span>
        <span className="trait-toggle-label">{toggle.label}</span>
        {toggle.note && <small>{toggle.note}</small>}
      </span>
      <Menu.CheckboxItemIndicator>
        <Check size={13} />
      </Menu.CheckboxItemIndicator>
    </Menu.CheckboxItem>
  );
}
