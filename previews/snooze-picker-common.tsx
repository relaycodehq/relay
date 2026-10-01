import type { KeyboardEvent, ReactNode } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { snoozePresets, wakeLabel } from "../shared/chat-activity";

export interface PickerProps {
  onSnooze: (at: number) => void;
}

/** Up/down between a list's buttons, like the real menu. */
export function listKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = [
    ...e.currentTarget.querySelectorAll<HTMLElement>("[data-item]"),
  ];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const step = e.key === "ArrowDown" ? 1 : -1;
  items[(at + step + items.length) % items.length]?.focus();
  e.preventDefault();
}

/** Today's menu: the presets, then one more row that opens the picker. */
export function PresetMenu({
  now,
  onSnooze,
  more,
  onMore,
}: PickerProps & { now: Date; more: string; onMore: () => void }) {
  return (
    <div className="sp-view sp-menu" onKeyDown={listKeys}>
      <div className="sb-menu-heading">Snooze until…</div>
      {snoozePresets(now).map((preset) => (
        <button
          key={preset.id}
          data-item
          className="sb-menu-item"
          onClick={() => onSnooze(preset.until)}
        >
          <span>{preset.label}</span>
          <small>{wakeLabel(preset.until, now)}</small>
        </button>
      ))}
      <div className="sb-menu-separator" />
      <button data-item className="sb-menu-item" onClick={onMore}>
        <span>{more}</span>
        <ChevronRight size={14} className="sp-chevron" />
      </button>
    </div>
  );
}

export function PickHead({
  onBack,
  children,
}: {
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="sp-head">
      <button
        className="sp-icon"
        aria-label="Back to presets"
        title="Back"
        onClick={onBack}
      >
        <ArrowLeft size={15} />
      </button>
      {children}
    </div>
  );
}
