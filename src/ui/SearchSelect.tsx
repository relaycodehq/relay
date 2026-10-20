import { Combobox } from "@base-ui/react/combobox";
import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, ChevronUp, Plus, Search } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { listRows } from "./search-select-rows";
import "./search-select.css";

export interface SearchOption {
  value: string;
  label: string;
  /** Muted text the label starts with, e.g. a branch's folder; the search reads it too. */
  prefix?: string;
  /** Muted text after the label, e.g. a path; the search reads it too. */
  detail?: string;
  icon?: ReactNode;
  /** Short muted text at the row's end that stays whole, e.g. an age. */
  note?: string;
  /** A heading the option sits under; groups keep the order they first appear in. */
  group?: string;
  /** Hidden behind a row under the list until that's opened or something is searched. */
  folded?: boolean;
  /** Listed but can't be picked. */
  disabled?: boolean;
}

// The value of the row that makes what was searched for; no option's.
const CREATE = "\0create";

const fullLabel = (o: SearchOption) => (o.prefix ?? "") + o.label;

/** A ComposerSelect for long lists: same trigger, a search over the options. */
export function SearchSelect({
  label,
  value,
  checked,
  options,
  onChange,
  placeholder = "Search…",
  unset,
  trigger,
  triggerLabel,
  triggerTitle,
  triggerClassName = "composer-control",
  action,
  create,
  footer,
  empty = "Nothing matches.",
  disabled,
  onOpenChange,
  className = "",
  foldNoun = "more",
  checkStart,
  limit,
  open: shown,
  anchor,
}: {
  label: string;
  /** The picked option, checked in the list; none for a menu of actions. */
  value?: string;
  /** Picks several instead: these are checked, and picking one keeps it open. */
  checked?: readonly string[];
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** The trigger's text while nothing is picked. */
  unset?: string;
  /** The trigger's content in place of the picked option and a chevron. */
  trigger?: ReactNode;
  /** Names a custom `trigger` whose content doesn't say what it picks. */
  triggerLabel?: string;
  /** The trigger's tooltip; a plain trigger's is the picked option. */
  triggerTitle?: string;
  triggerClassName?: string;
  /** A row under the list that does something else, e.g. open Finder. */
  action?: { label: string; icon?: ReactNode; onSelect: () => void };
  /** A last row that makes what was searched for, when `label` names one for it. */
  create?: {
    label: (search: string) => string | undefined;
    onSelect: (search: string) => void;
  };
  /** Under everything, e.g. a hint or an error. */
  footer?: ReactNode;
  /** Said while there are no options at all, e.g. still loading. */
  empty?: string;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** What the folded options are, for the row that shows them: "Show 78 merged branches". */
  foldNoun?: string;
  /** The check goes in a column before the labels instead of at the row's end. */
  checkStart?: boolean;
  /**
   * Rows listed at most, the picked one aside; a search still reaches every
   * option. Thousands of rows are slow to draw and no use to scroll.
   */
  limit?: number;
  /** Opened by something else, e.g. a menu item; `onOpenChange` hears when it closes. */
  open?: boolean;
  /** With `open`: where the list shows, in place of a trigger of its own. */
  anchor?: RefObject<Element | null>;
}) {
  const [own, setOpen] = useState(false);
  // Every change below tells `onOpenChange`, which is how an owner of `open` hears it.
  const open = shown ?? own;
  useEffect(() => {
    if (shown) {
      setSearch("");
      setUnfolded(undefined);
    }
  }, [shown]);
  const [search, setSearch] = useState("");
  const [unfolded, setUnfolded] = useState<boolean>();
  const input = useRef<HTMLInputElement>(null);
  const foldHeading = useRef<HTMLDivElement>(null);
  const picked = options.find((o) => o.value === value);
  const selectedLabel = picked ? fullLabel(picked) : value || unset;
  const query = search.trim().toLowerCase();
  const matches = options.filter((o) =>
    `${fullLabel(o)} ${o.detail ?? ""}`.toLowerCase().includes(query),
  );
  // A search reaches into the fold, and so does a pick made from it.
  const foldOpen = !!query || (unfolded ?? !!picked?.folded);
  const foldGroup = options.find((o) => o.folded)?.group;
  const folded = options.filter((o) => o.folded).length;
  const { groups, listed, over } = listRows(matches, {
    foldOpen,
    limit,
    value,
  });
  const creating = query ? create?.label(search.trim()) : undefined;
  // Keyboard order follows what's on screen, group by group.
  const ordered = [
    ...[...groups.values()].flat().map((o) => o.value),
    ...(creating ? [CREATE] : []),
  ];
  const isChecked = (option: SearchOption) =>
    checked
      ? checked.includes(option.value)
      : value !== undefined && option.value === value;
  const item = (option: SearchOption) => (
    <Combobox.Item
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      className="composer-select-item"
    >
      {checkStart && (
        <span className="search-select-check-start">
          {isChecked(option) && <Check size={13} />}
        </span>
      )}
      {option.icon}
      <span className="search-select-label">
        {option.prefix && (
          <span className="search-select-prefix">{option.prefix}</span>
        )}
        {option.label}
      </span>
      {option.detail && (
        <small className="search-select-detail">{option.detail}</small>
      )}
      {option.note && (
        <small className="search-select-note">{option.note}</small>
      )}
      {!checkStart && isChecked(option) && (
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
        if (next) {
          setSearch("");
          setUnfolded(undefined);
        }
      }}
    >
      {!anchor && (
        <Popover.Trigger
          type="button"
          aria-label={trigger ? triggerLabel : label}
          title={triggerTitle ?? (trigger ? undefined : selectedLabel)}
          className={triggerClassName}
          disabled={disabled}
        >
          {trigger ?? (
            <>
              <span>{selectedLabel}</span>
              <ChevronDown size={12} />
            </>
          )}
        </Popover.Trigger>
      )}
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
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
              items={ordered}
              filter={null}
              inputValue={search}
              onInputValueChange={setSearch}
              value={null}
              onValueChange={(next) => {
                if (next === null) return;
                if (next === CREATE) create?.onSelect(search.trim());
                else onChange(next);
                if (checked) return;
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
                        <Combobox.GroupLabel
                          ref={group === foldGroup ? foldHeading : undefined}
                          className="composer-menu-label"
                        >
                          {group}
                        </Combobox.GroupLabel>
                        {list.map(item)}
                      </Combobox.Group>
                    ),
                  )}
                  {creating && (
                    <Combobox.Item
                      value={CREATE}
                      className="composer-select-item"
                    >
                      {checkStart && (
                        <span className="search-select-check-start" />
                      )}
                      <Plus size={13} />
                      <span className="search-select-label">{creating}</span>
                    </Combobox.Item>
                  )}
                </Combobox.List>
                {!matches.length && !creating && (
                  <p className="search-select-empty">
                    {options.length ? "Nothing matches." : empty}
                  </p>
                )}
                {over > 0 && (
                  <p className="search-select-empty">
                    Type to narrow down {listed + over} {label.toLowerCase()}.
                  </p>
                )}
              </div>
              {!query && folded > 0 && (
                <button
                  type="button"
                  className="composer-select-item search-select-fold"
                  aria-expanded={foldOpen}
                  onClick={() => {
                    setUnfolded(!foldOpen);
                    // Bring what it opened into view, heading first.
                    if (!foldOpen)
                      requestAnimationFrame(() =>
                        foldHeading.current?.scrollIntoView({ block: "start" }),
                      );
                  }}
                >
                  <span>
                    {foldOpen
                      ? `Hide ${foldNoun}`
                      : `Show ${folded} ${foldNoun}`}
                  </span>
                  {foldOpen ? (
                    <ChevronUp size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                </button>
              )}
              {action && (
                <Popover.Close
                  className="composer-select-item search-select-action"
                  onClick={action.onSelect}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </Popover.Close>
              )}
              {footer}
            </Combobox.Root>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
