import { useSyncExternalStore } from "react";

/** The shells a thread's dock has as tabs, by slot ("" is the first shell). */
export interface DockTabs {
  slots: string[];
  front: string;
}

const STORAGE_KEY = "relay-terminal-dock";
const REMEMBERED = 200;
const FIRST: DockTabs = { slots: [""], front: "" };

/** Tabs per thread key; the shells outlive a reload, so the tabs do too. */
const docks = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return new Map<string, DockTabs>(
      Array.isArray(saved)
        ? saved.filter(
            (entry): entry is [string, DockTabs] =>
              Array.isArray(entry) &&
              typeof entry[0] === "string" &&
              Array.isArray(entry[1]?.slots) &&
              entry[1].slots.length > 0 &&
              entry[1].slots.includes(entry[1].front),
          )
        : [],
    );
  } catch {
    return new Map<string, DockTabs>();
  }
})();
/** Whether each thread's dock shows; only for as long as the window lives. */
const openKeys = new Set<string>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
function emit() {
  for (const listener of listeners) listener();
}

/** A new shell's slot, unique without knowing which others exist. */
export const newTerminalSlot = () =>
  Math.random().toString(36).slice(2, 10) || "x";

export const dockTabs = (key: string) => docks.get(key) ?? FIRST;

export function setDockTabs(key: string, tabs: DockTabs) {
  docks.delete(key);
  if (tabs.slots.length !== 1 || tabs.slots[0] !== "") docks.set(key, tabs);
  for (const oldest of docks.keys()) {
    if (docks.size <= REMEMBERED) break;
    docks.delete(oldest);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...docks]));
  } catch {
    // Still remembered for this session.
  }
  emit();
}

/** Puts `slot` in the dock as its front tab, adding it when it isn't there. */
export function frontInDock(key: string, slot: string) {
  const { slots } = dockTabs(key);
  setDockTabs(key, {
    slots: slots.includes(slot) ? slots : [...slots, slot],
    front: slot,
  });
}

export function setTerminalOpen(key: string, open: boolean) {
  if (open === openKeys.has(key)) return;
  if (open) openKeys.add(key);
  else openKeys.delete(key);
  emit();
}

/** A draft's dock becomes the new thread's. */
export function moveDock(from: string, to: string) {
  const tabs = docks.get(from);
  if (tabs && !docks.has(to)) {
    docks.delete(from);
    setDockTabs(to, tabs);
  }
  if (openKeys.delete(from)) openKeys.add(to);
  emit();
}

/** Whether the thread's dock is open; each thread remembers its own. */
export function useTerminalOpen(key: string) {
  return useSyncExternalStore(subscribe, () => openKeys.has(key));
}

export function useDockTabs(key: string) {
  return useSyncExternalStore(subscribe, () => dockTabs(key));
}
