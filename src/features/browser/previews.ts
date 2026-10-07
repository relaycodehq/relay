import { useSyncExternalStore } from "react";
import type { PreviewState } from "../../../shared/preview";
import { api } from "../../lib/api";

/** The previews' last pushed states, by thread key. */
const states = new Map<string, PreviewState>();
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | undefined;

function subscribe(listener: () => void) {
  unsubscribe ??= api.onPreview((state) => {
    states.set(state.key, state);
    for (const notify of listeners) notify();
  });
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A thread's preview key: its chat id, a draft's `draft:<projectId>`. */
export const previewKey = (projectId: string, chatId: string | null) =>
  chatId ?? `draft:${projectId}`;

export function usePreviewState(key: string) {
  return useSyncExternalStore(subscribe, () => states.get(key));
}

/** Opens the thread's preview, starting its dev server if it needs one. */
export async function openPreview(projectId: string, chatId: string | null) {
  const state = await api.openPreview(projectId, chatId);
  states.set(state.key, state);
  for (const notify of listeners) notify();
  return state;
}

export function closePreview(key: string) {
  states.delete(key);
  void api.closePreview(key);
}
