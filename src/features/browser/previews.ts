import { useSyncExternalStore } from "react";
import type { PickedElement, PreviewState } from "../../../shared/preview";
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

/** What a picked element puts in the composer: where it is, and its picture. */
export function pickedContext(picked: PickedElement) {
  const lines = [
    `This element in the preview at ${picked.url}:`,
    "```html",
    picked.tag,
    "```",
  ];
  if (picked.selector) lines.push(`Selector: \`${picked.selector}\``);
  if (picked.text) lines.push(`Its text: "${picked.text}"`);
  const bytes = Uint8Array.from(atob(picked.image.split(",")[1] ?? ""), (c) =>
    c.charCodeAt(0),
  );
  return {
    text: lines.join("\n"),
    images: [new File([bytes], "element.png", { type: "image/png" })],
  };
}
