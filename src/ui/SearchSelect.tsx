import { Combobox } from "@base-ui/react/combobox";
import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import "./search-select.css";

export interface SearchOption {
  value: string;
  label: string;
  /** Muted text after the label, e.g. a path; the search reads it too. */
  detail?: string;
  icon?: ReactNode;
  /** A heading the option sits under; groups keep the order they first appear in. */
  group?: string;
}

/** A ComposerSelect for long lists: same trigger, a search over the options. */
export function SearchSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Search…",
  unset,
  trigger,
  triggerClassName = "composer-control",
  action,
  empty = "Nothing matches.",
  disabled,
  onOpenChange,
  className = "",
}: {
  label: string;
  /** The picked option, checked in the list; none for a menu of actions. */
  value?: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** The trigger's text while nothing is picked. */
  unset?: string;
  /** The trigger's content in place of the picked option and a chevron. */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** A row under the list that does something else, e.g. open Finder. */
  action?: { label: string; icon?: ReactNode; onSelect: () => void };
  /** Said while there are no options at all, e.g. still loading. */
  empty?: string;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const query = search.trim().toLowerCase();
  const matches = options.filter((o) =>
    `${o.label} ${o.detail ?? ""}`.toLowerCase().includes(query),
  );
  const groups = new Map<string | undefined, SearchOption[]>();
  for (const o of matches)
    groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
  // Keyboard order follows what's on screen, group by group.
  const ordered = [...groups.values()].flat();
  const item = (option: SearchOption) => (
    <Combobox.Item
      key={option.value}
      value={option.value}
      index={ordered.indexOf(option)}
      className="composer-select-item"
    >
      {option.icon}
      <span className="search-select-label">{option.label}</span>
      {option.detail && (
        <small className="search-select-detail">{option.detail}</small>
      )}
      {value !== undefined && option.value === value && (
        <Check size={13} className="search-select-check" />
      )}
    </Combobox.Item>
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
        if (next) setSearch("");
      }}
    >
      <Popover.Trigger
        type="button"
        aria-label={trigger ? undefined : label}
        className={triggerClassName}
        disabled={disabled}
      >
        {trigger ?? (
          <>
            <span>
              {options.find((o) => o.value === value)?.label ??
                (value || unset)}
            </span>
            <ChevronDown size={12} />
          </>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          <Popover.Popup
            className={`composer-select-popup search-select-popup ${className}`}
            aria-label={label}
            initialFocus={input}
          >
            <Combobox.Root<string>
              inline
              open
              autoHighlight
              items={ordered.map((o) => o.value)}
              filter={null}
              inputValue={search}
              onInputValueChange={setSearch}
              value={null}
              onValueChange={(next) => {
                if (next === null) return;
                onChange(next);
                setOpen(false);
                onOpenChange?.(false);
              }}
            >
              <div className="search-select-search">
                <Search size={14} />
                <Combobox.Input
                  ref={input}
                  aria-label={`Search ${label.toLowerCase()}`}
                  placeholder={placeholder}
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpen(false);
                      onOpenChange?.(false);
                    }
                  }}
                />
              </div>
              <div className="search-select-scroll">
                <Combobox.List aria-label={label}>
                  {[...groups].map(([group, list]) =>
                    group === undefined ? (
                      list.map(item)
                    ) : (
                      <Combobox.Group key={group}>
                        <Combobox.GroupLabel className="composer-menu-label">
                          {group}
                        </Combobox.GroupLabel>
                        {list.map(item)}
                      </Combobox.Group>
                    ),
                  )}
                </Combobox.List>
                {!matches.length && (
                  <p className="search-select-empty">
                    {options.length ? "Nothing matches." : empty}
                  </p>
                )}
              </div>
              {action && (
                <Popover.Close
                  className="composer-select-item search-select-action"
                  onClick={action.onSelect}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </Popover.Close>
              )}
            </Combobox.Root>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
