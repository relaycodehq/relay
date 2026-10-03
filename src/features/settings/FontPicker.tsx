import { useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Combobox } from "@base-ui/react/combobox";
import { ChevronDown, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  installedFonts,
  isFontInstalled,
  type FontFamily,
} from "./local-fonts";
import { fontStack } from "../../lib/typography";
import "../projects/projects.css";
import "../changes/branch-picker.css";

const LIMIT = 150;

/**
 * A searchable list of installed families, each shown in its own face. The
 * empty value is the default, which follows another setting or the system.
 */
export function FontPicker({
  label,
  value,
  defaultLabel,
  fallback,
  mono,
  onChange,
}: {
  label: string;
  value: string;
  defaultLabel: string;
  /** The stack the default and every family fall back to. */
  fallback: string;
  /** Offer only monospaced families. */
  mono?: boolean;
  onChange: (family: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const fonts = useQuery({
    queryKey: ["installed-fonts"],
    queryFn: installedFonts,
    staleTime: Infinity,
  });
  const query = search.trim();
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (fonts.data ?? []).filter(
      (font: FontFamily) =>
        (!mono || font.mono) &&
        words.every((word) => font.family.toLowerCase().includes(word)),
    );
  }, [fonts.data, mono, query]);
  // A family the list missed can still be typed in, if it's installed.
  const typed =
    query &&
    fonts.isSuccess &&
    !matches.some((f) => f.family.toLowerCase() === query.toLowerCase()) &&
    isFontInstalled(query)
      ? query
      : null;
  const items = [
    ...(query ? [] : [""]),
    ...(typed ? [typed] : []),
    ...matches.slice(0, LIMIT).map((f) => f.family),
  ];
  const choose = (family: string) => {
    setOpen(false);
    if (family !== value) onChange(family);
  };

  return (
    <div className="composer-tools model-field font-picker">
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setSearch("");
        }}
      >
        <Popover.Trigger className="composer-control" aria-label={label}>
          <span style={{ fontFamily: fontStack(value, fallback) }}>
            {value || defaultLabel}
          </span>
          <ChevronDown size={12} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="headline-project-positioner"
            align="end"
            sideOffset={6}
            collisionPadding={12}
          >
            <Popover.Popup
              className="headline-project-popup"
              aria-label={label}
              initialFocus={input}
            >
              <Combobox.Root<string>
                inline
                open
                autoHighlight
                items={items}
                filter={null}
                inputValue={search}
                onInputValueChange={setSearch}
                value={null}
                onValueChange={(family) => {
                  if (family !== null) choose(family);
                }}
              >
                <div className="headline-project-search">
                  <Search size={15} />
                  <Combobox.Input
                    ref={input}
                    aria-label={`Search ${label.toLowerCase()}s`}
                    placeholder="Search fonts…"
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
                <div className="headline-project-scroll">
                  <Combobox.List aria-label={label}>
                    {items.map((family, index) => (
                      <Combobox.Item
                        key={family || "default"}
                        value={family}
                        index={index}
                        className="branch-picker-row"
                        data-current={family === value ? "" : undefined}
                        style={{ fontFamily: fontStack(family, fallback) }}
                      >
                        <span>{family || defaultLabel}</span>
                        {family === typed && <small>Not in the list</small>}
                      </Combobox.Item>
                    ))}
                  </Combobox.List>
                  {fonts.isPending && (
                    <p className="headline-project-empty">Finding fonts…</p>
                  )}
                  {!fonts.isPending && !items.length && (
                    <p className="headline-project-empty">
                      No installed {mono ? "monospaced " : ""}font matches “
                      {query}”.
                    </p>
                  )}
                  {matches.length > LIMIT && (
                    <p className="headline-project-empty">
                      Type to narrow down {matches.length} fonts.
                    </p>
                  )}
                </div>
              </Combobox.Root>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
