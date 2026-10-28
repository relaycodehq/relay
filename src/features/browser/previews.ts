import { useSyncExternalStore } from "react";
import { pageKey, type PreviewState } from "../../../shared/preview";
import { api } from "../../lib/api";

/** The previews' last pushed states, by key. */
const states = new Map<string, PreviewState>();
const listeners = new Set<() => void>();
/** Counts changes to any of them. */
let version = 0;
let unsubscribe: (() => void) | undefined;

function changed() {
  version++;
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void) {
  unsubscribe ??= api.onPreview((state) => {
    states.set(state.key, state);
    changed();
  });
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * A thread's preview key: its chat id, a draft's `draft:<projectId>`; with
 * `page`, another page the user opened beside it.
 */
export const previewKey = (
  projectId: string,
  chatId: string | null,
  page?: string,
) => pageKey(chatId ?? `draft:${projectId}`, page);

export function usePreviewState(key: string) {
  return useSyncExternalStore(subscribe, () => states.get(key));
}

/** Every preview's state by key, for the panel's tabs, one per page. */
export function usePreviewStates() {
  useSyncExternalStore(subscribe, () => version);
  return (key: string) => states.get(key);
}

/** Opens the thread's preview, starting its dev server if it needs one. */
export async function openPreview(
  projectId: string,
  chatId: string | null,
  page?: string,
) {
  const state = await api.openPreview(projectId, chatId, page);
  states.set(state.key, state);
  changed();
  return state;
}

export function closePreview(key: string) {
  states.delete(key);
  void api.closePreview(key);
}
