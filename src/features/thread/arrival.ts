import { useSyncExternalStore } from "react";
import type { AwayWindow } from "../../../shared/chat-activity";

/** What the open thread missed while you were away from it, for its "New" divider. */
export interface Arrival {
  chatId: string;
  away: AwayWindow[];
  /** The divider was seen and has faded; its space stays until the thread is opened again. */
  read: boolean;
}

/**
 * The open thread's arrival as the sidebar marks it read, which happens only
 * with Relay in front. Opening a thread starts afresh. Coming back to the
 * window after answers landed adds the time away, unless the divider has
 * already faded: then it starts afresh at the new answers instead of coming
 * back where it was.
 */
export function nextArrival(
  prev: Arrival | undefined,
  next: {
    chatId: string;
    /** readUpTo for the thread, taken before it's marked read again. */
    readTo: number;
    /** The thread's last activity. */
    updated: number;
    now: number;
    opened: boolean;
    refocused: boolean;
  },
): Arrival | undefined {
  const gap = { from: next.readTo, to: next.now };
  if (next.opened || prev?.chatId !== next.chatId)
    return { chatId: next.chatId, away: [gap], read: false };
  if (!next.refocused || next.updated <= next.readTo) return prev;
  return {
    chatId: next.chatId,
    away: prev.read ? [gap] : [...prev.away, gap],
    read: false,
  };
}

let current: Arrival | undefined;
/** When each thread's divider faded, this run: what was there then was seen, so going back to it doesn't bring the divider back. */
const faded = new Map<string, number>();
const listeners = new Set<() => void>();
function set(next: Arrival | undefined) {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export function noteArrival(next: Parameters<typeof nextArrival>[1]) {
  const readTo = Math.max(next.readTo, faded.get(next.chatId) ?? 0);
  set(nextArrival(current, { ...next, readTo }));
}

/** No thread is open. */
export function clearArrival() {
  set(undefined);
}

export function markArrivalRead(chatId: string) {
  if (current?.chatId !== chatId || current.read) return;
  faded.set(chatId, Date.now());
  set({ ...current, read: true });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useArrival(chatId: string | undefined) {
  const arrival = useSyncExternalStore(subscribe, () => current);
  return arrival && arrival.chatId === chatId ? arrival : undefined;
}

/** The thread on screen, as the sidebar last marked it read; undefined with none open. */
export const openThreadId = () => current?.chatId;
