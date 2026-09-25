import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { Fragment, memo } from "react";

export type TraitSection = {
  label: string;
  /** Keys that change this without opening the menu. */
  hint?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
};
/**
 * T3's TraitsPicker: related choices behind one trigger that names them all,
 * e.g. "High · 200k".
 */
export const ComposerTraitsMenu = memo(function ComposerTraitsMenu({
  label,
  sections,
}: {
  label: string;
  sections: TraitSection[];
}) {
  const summary = sections
    .map((s) => s.options.find((o) => o.value === s.value)?.label)
    .filter(Boolean)
    .join(" · ");
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} className="composer-control">
        {summary}
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
                </Menu.Group>
              </Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
});
