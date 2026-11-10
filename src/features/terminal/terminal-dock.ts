import { useSyncExternalStore } from "react";
import { readJson, writeJson } from "../../lib/persisted-store";

/** The shells a thread's dock has as tabs, by slot ("" is the first shell). */
export interface DockTabs {
  slots: string[];
  front: string;
}

const STORAGE_KEY = "relay-terminal-dock";
const REMEMBERED = 200;
const FIRST: DockTabs = { slots: [""], front: "" };

/** What's saved: tabs per thread key; the shells outlive a reload, so the tabs do too. */
function readDocks() {
  const saved = readJson(STORAGE_KEY);
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
}

let docks = readDocks();

/** Keeps `from`'s tabs where they are unchanged, so what shows them doesn't redraw. */
function sameTabs(from: Map<string, DockTabs>, to: Map<string, DockTabs>) {
  for (const [key, tabs] of to) {
    const was = from.get(key);
    if (
      was &&
      was.front === tabs.front &&
      was.slots.join() === tabs.slots.join()
    )
      to.set(key, was);
  }
  return to;
}

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

/**
 * Applies one change to what's saved rather than to this window's copy, which
 * may lack what another window saved since: the thread it's about changes,
 * the others stay as they are.
 */
function changeDocks(change: (saved: Map<string, DockTabs>) => void) {
  const saved = readDocks();
  change(saved);
  for (const oldest of saved.keys()) {
    if (saved.size <= REMEMBERED) break;
    saved.delete(oldest);
  }
  writeJson(STORAGE_KEY, [...saved]);
  docks = sameTabs(docks, saved);
  emit();
}

function putTabs(saved: Map<string, DockTabs>, key: string, tabs: DockTabs) {
  saved.delete(key);
  if (tabs.slots.length !== 1 || tabs.slots[0] !== "") saved.set(key, tabs);
}

export const setDockTabs = (key: string, tabs: DockTabs) =>
  changeDocks((saved) => putTabs(saved, key, tabs));

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
  changeDocks((saved) => {
    const tabs = saved.get(from);
    if (!tabs || saved.has(to)) return;
    saved.delete(from);
    putTabs(saved, to, tabs);
  });
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

// Another window saved its tabs: this one shows them too.
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    docks = sameTabs(docks, readDocks());
    emit();
  });
