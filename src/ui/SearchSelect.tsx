import { Combobox } from "@base-ui/react/combobox";
import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { useRef, useState } from "react";
import "./search-select.css";

/** A ComposerSelect for long lists: same trigger, a search over the options. */
export function SearchSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Search…",
  unset,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** The trigger's text while nothing is picked. */
  unset?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const query = search.trim().toLowerCase();
  const matches = options.filter((o) => o.label.toLowerCase().includes(query));
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSearch("");
      }}
    >
      <Popover.Trigger
        type="button"
        aria-label={label}
        className="composer-control"
      >
        <span>
          {options.find((o) => o.value === value)?.label ?? (value || unset)}
        </span>
        <ChevronDown size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          <Popover.Popup
            className="composer-select-popup search-select-popup"
            aria-label={label}
            initialFocus={input}
          >
            <Combobox.Root<string>
              inline
              open
              autoHighlight
              items={matches.map((o) => o.value)}
              filter={null}
              inputValue={search}
              onInputValueChange={setSearch}
              value={null}
              onValueChange={(next) => {
                if (next === null) return;
                onChange(next);
                setOpen(false);
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
                    }
                  }}
                />
              </div>
              <div className="search-select-scroll">
                <Combobox.List aria-label={label}>
                  {matches.map((option, index) => (
                    <Combobox.Item
                      key={option.value}
                      value={option.value}
                      index={index}
                      className="composer-select-item"
                    >
                      <span className="search-select-label">
                        {option.label}
                      </span>
                      {option.value === value && <Check size={13} />}
                    </Combobox.Item>
                  ))}
                </Combobox.List>
                {!matches.length && (
                  <p className="search-select-empty">Nothing matches.</p>
                )}
              </div>
            </Combobox.Root>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
