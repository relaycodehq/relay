import { Popover } from "@base-ui/react/popover";
import { CalendarClock, ChevronRight, Clock } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { snoozePresets, wakeLabel } from "../../shared/chat-activity";
import { PickTime } from "./PickTime";

/** Up and down between the presets, like the menus around them. */
function presetKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("button")];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const step = e.key === "ArrowDown" ? 1 : -1;
  rows[(at + step + rows.length) % rows.length]?.focus();
}

/**
 * A card's clock: the presets, and "Pick a time…" turning the same popup
 * into a calendar and a drum. A popover rather than a menu, which would
 * take the calendar's arrow keys for itself.
 */
export function SnoozeMenu({
  onSnooze,
  now,
}: {
  onSnooze: (until: number) => void;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  // The card lays its clock out only on hover or while this is open. Keep it
  // through the closing fade too, or the popup loses its anchor and fades
  // out in the window's corner.
  const [shown, setShown] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const presets = useMemo(() => snoozePresets(new Date(now)), [now]);
  const snooze = (until: number) => {
    setOpen(false);
    onSnooze(until);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setPicking(false);
        setShown(true);
      }}
      onOpenChangeComplete={(next) => !next && setShown(false)}
    >
      <Popover.Trigger
        data-popup-shown={shown || undefined}
        className="sb-card-action icon"
        aria-label="Snooze"
        title="Snooze"
        onClick={(e) => e.stopPropagation()}
      >
        <Clock size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="sb-menu-positioner"
        >
          {/* React bubbles clicks out of the portal to the card, which would open its thread. */}
          <Popover.Popup
            className="sb-menu"
            aria-label="Snooze"
            onClick={(e) => e.stopPropagation()}
          >
            {picking ? (
              <PickTime
                action="Snooze"
                onPick={snooze}
                onBack={() => {
                  setPicking(false);
                  requestAnimationFrame(() => more.current?.focus());
                }}
              />
            ) : (
              <div className="sb-snooze-presets" onKeyDown={presetKeys}>
                <div className="sb-menu-heading">Snooze until…</div>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    className="sb-menu-item"
                    onClick={() => snooze(preset.until)}
                  >
                    <span>{preset.label}</span>
                    <small>{wakeLabel(preset.until, new Date(now))}</small>
                  </button>
                ))}
                <div className="sb-menu-separator" />
                <button
                  ref={more}
                  className="sb-menu-item"
                  onClick={() => setPicking(true)}
                >
                  <span className="sb-menu-label">
                    <CalendarClock size={14} />
                    Pick a time…
                  </span>
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
