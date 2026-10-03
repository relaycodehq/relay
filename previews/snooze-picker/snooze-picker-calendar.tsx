// B · Calendar: "Pick a time…" turns the menu into a month with a drum of
// half-hours beside it: the real PickTime, as the snooze menu shows it.
import { useState } from "react";
import { PickTime } from "../../src/ui/PickTime";
import { PresetMenu, type PickerProps } from "./snooze-picker-common";

export function CalendarPicker({ onSnooze }: PickerProps) {
  const [now] = useState(() => new Date());
  const [picking, setPicking] = useState(false);
  return picking ? (
    <PickTime
      action="Snooze"
      onPick={onSnooze}
      onBack={() => setPicking(false)}
    />
  ) : (
    <PresetMenu
      now={now}
      onSnooze={onSnooze}
      more="Pick a time…"
      onMore={() => setPicking(true)}
    />
  );
}
