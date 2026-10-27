import { useSyncExternalStore } from "react";
import type { Schedule } from "../../../shared/schedules";

/**
 * Which schedule the page shows, or that the examples for a new one are
 * showing instead. The sidebar picks, the page shows.
 */
export interface SchedulePick {
  /** Nothing picked shows the first one. */
  picked?: string;
  choosingNew: boolean;
}

let current: SchedulePick = { choosingNew: false };
const listeners = new Set<() => void>();

function set(next: SchedulePick) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const pickSchedule = (id: string | undefined) =>
  set({ picked: id, choosingNew: false });

export const chooseNewSchedule = () => set({ ...current, choosingNew: true });

export const useSchedulePick = () =>
  useSyncExternalStore(subscribe, () => current);

/** The schedule on the page: the picked one, else the first, while no new one is being chosen. */
export function shownSchedule(schedules: Schedule[], pick: SchedulePick) {
  if (pick.choosingNew) return undefined;
  return schedules.find((s) => s.id === pick.picked) ?? schedules[0];
}
