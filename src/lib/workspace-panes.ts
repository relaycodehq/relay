import { useCallback, useEffect, useState } from "react";

export type PaneId = "chat" | "changes" | "files" | "history";
export const PANE_IDS: PaneId[] = ["chat", "changes", "files", "history"];
const DEFAULT_WEIGHTS: Record<PaneId, number> = {
  chat: 0.85,
  changes: 1.6,
  files: 1.6,
  history: 1.2,
};
const STORAGE_KEY = "relay-workspace-panes";

export interface PaneLayout {
  order: PaneId[];
  open: Record<PaneId, boolean>;
  weights: Record<PaneId, number>;
}

function restore(): Pick<PaneLayout, "order" | "weights"> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const order: PaneId[] = Array.isArray(saved?.order)
      ? saved.order.filter((id: unknown): id is PaneId =>
          PANE_IDS.includes(id as PaneId),
        )
      : [];
    // Panes added since the layout was saved go at the end.
    if (order.length && new Set(order).size === order.length)
      order.push(...PANE_IDS.filter((id) => !order.includes(id)));
    const weights = { ...DEFAULT_WEIGHTS };
    for (const id of PANE_IDS) {
      const value = Number(saved?.weights?.[id]);
      if (value > 0.1 && value < 10) weights[id] = value;
    }
    return {
      order: new Set(order).size === PANE_IDS.length ? order : [...PANE_IDS],
      weights,
    };
  } catch {
    return { order: [...PANE_IDS], weights: { ...DEFAULT_WEIGHTS } };
  }
}

/** Chat, changes and files are peers: each can be shown, hidden and reordered. */
export function useWorkspacePanes() {
  const [layout, setLayout] = useState<PaneLayout>(() => ({
    ...restore(),
    open: { chat: true, changes: false, files: false, history: false },
  }));
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ order: layout.order, weights: layout.weights }),
    );
  }, [layout.order, layout.weights]);
  const setOpen = useCallback(
    (id: PaneId, open: boolean) =>
      setLayout((l) => {
        const next = { ...l.open, [id]: open };
        // Never leave the workspace empty: the chat is the fallback pane.
        if (!PANE_IDS.some((p) => next[p])) next.chat = true;
        return { ...l, open: next };
      }),
    [],
  );
  const show = useCallback((id: PaneId) => setOpen(id, true), [setOpen]);
  const closeCode = useCallback(
    () =>
      setLayout((l) => ({
        ...l,
        open: { chat: true, changes: false, files: false, history: false },
      })),
    [],
  );
  const move = useCallback(
    (id: PaneId, target: PaneId, after: boolean) =>
      setLayout((l) => {
        if (id === target) return l;
        const order = l.order.filter((p) => p !== id);
        order.splice(order.indexOf(target) + (after ? 1 : 0), 0, id);
        return { ...l, order };
      }),
    [],
  );
  const resize = useCallback(
    (weights: Partial<Record<PaneId, number>>) =>
      setLayout((l) => ({ ...l, weights: { ...l.weights, ...weights } })),
    [],
  );
  const visible = layout.order.filter((id) => layout.open[id]);
  return { layout, visible, setOpen, show, closeCode, move, resize };
}
