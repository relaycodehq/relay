import type { DragEvent } from "react";

/** What a dragged tab carries: its split and id. */
const TAB_TYPE = "application/x-relay-editor-tab";

export const carriesTab = (e: DragEvent) =>
  e.dataTransfer.types.includes(TAB_TYPE);

export function startDraggingTab(e: DragEvent, from: string, id: string) {
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(TAB_TYPE, JSON.stringify({ from, id }));
}

/** The tab being dragged, from any split, as it crosses this one. */
export function draggedTab(e: DragEvent) {
  const raw = e.dataTransfer.getData(TAB_TYPE);
  if (!raw) return;
  try {
    const { from, id } = JSON.parse(raw) as { from: string; id: string };
    return typeof from === "string" && typeof id === "string"
      ? { from, id }
      : undefined;
  } catch {
    return undefined;
  }
}
