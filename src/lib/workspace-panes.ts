import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type PaneId = "chat" | "changes" | "panel";
const PANE_IDS: PaneId[] = ["chat", "changes", "panel"];
const DEFAULT_WEIGHTS: Record<PaneId, number> = {
  chat: 0.85,
  changes: 1.6,
  panel: 1.4,
};
/** Panes that became tabs in the panel; saved layouts still name them. */
const LEGACY = ["files", "history"];
const paneOf = (id: unknown): PaneId | undefined =>
  PANE_IDS.includes(id as PaneId)
    ? (id as PaneId)
    : LEGACY.includes(id as string)
      ? "panel"
      : undefined;
/** Ids saved for a thread, legacy ones folded into the panel. */
const panesIn = (ids: unknown[]) => [
  ...new Set(ids.map(paneOf).filter((id) => id !== undefined)),
];
const STORAGE_KEY = "relay-workspace-panes";
const THREADS_KEY = "relay-thread-panes";
const REMEMBERED_THREADS = 200;

type OpenPanes = Record<PaneId, boolean>;

interface PaneLayout {
  order: PaneId[];
  /** The thread (or unsent draft) `open` belongs to. */
  thread: string;
  open: OpenPanes;
  weights: Record<PaneId, number>;
}

const CHAT_ONLY: OpenPanes = {
  chat: true,
  changes: false,
  panel: false,
};

/**
 * Panes each thread had open when last on screen, least recently used first.
 * Files and History saved before they moved into the panel stay listed until
 * the thread is next seen, so the panel can open them as its tabs.
 */
const openByThread = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(THREADS_KEY) || "[]");
    return new Map<string, string[]>(
      Array.isArray(saved)
        ? saved.filter(
            (entry): entry is [string, string[]] =>
              Array.isArray(entry) &&
              typeof entry[0] === "string" &&
              Array.isArray(entry[1]) &&
              entry[1].every((id: unknown) => paneOf(id) !== undefined),
          )
        : [],
    );
  } catch {
    return new Map<string, string[]>();
  }
})();

/** Files or History the thread had open as panes before the panel took them. */
export function legacyTabs(thread: string): ("files" | "history")[] {
  return (openByThread.get(thread) ?? []).filter(
    (id): id is "files" | "history" => LEGACY.includes(id),
  );
}

function recall(thread: string): OpenPanes | undefined {
  const saved = openByThread.get(thread);
  if (!saved?.length) return;
  const ids = panesIn(saved);
  return Object.fromEntries(
    PANE_IDS.map((id) => [id, ids.includes(id)]),
  ) as OpenPanes;
}

function remember(thread: string, open: OpenPanes) {
  if (!thread) return;
  openByThread.delete(thread);
  openByThread.set(
    thread,
    PANE_IDS.filter((id) => open[id]),
  );
  for (const oldest of openByThread.keys()) {
    if (openByThread.size <= REMEMBERED_THREADS) break;
    openByThread.delete(oldest);
  }
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify([...openByThread]));
  } catch {
    // Still remembered for this session.
  }
}

function restore(): Pick<PaneLayout, "order" | "weights"> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const order: PaneId[] = Array.isArray(saved?.order)
      ? panesIn(saved.order)
      : [];
    // Panes added since the layout was saved go at the end.
    if (order.length && new Set(order).size === order.length)
      order.push(...PANE_IDS.filter((id) => !order.includes(id)));
    const weights = { ...DEFAULT_WEIGHTS };
    for (const id of PANE_IDS) {
      const value = Number(
        saved?.weights?.[id] ?? (id === "panel" ? saved?.weights?.files : 0),
      );
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

/** What a thread starts with: the saved order and widths, and its own open panes. */
export const restoredLayout = (thread: string): PaneLayout => ({
  ...restore(),
  thread,
  open: recall(thread) ?? CHAT_ONLY,
});

/** The open panes, in order. */
const visiblePanes = ({ order, open }: Pick<PaneLayout, "order" | "open">) =>
  order.filter((id) => open[id]);

/** A folder without Git has no changes to show. */
export const panesOf = (order: PaneId[], plain?: boolean) =>
  plain ? order.filter((id) => id !== "changes") : order;

/**
 * Where pane `id` sits in the row: its place in the order and its share of
 * the row, the open panes' shares adding up to 1 so they always fill it.
 * `previous` is the open pane before it, which its splitter resizes against.
 */
export function paneFrame(
  layout: Pick<PaneLayout, "order" | "open" | "weights">,
  id: PaneId,
) {
  const { order, open, weights } = layout;
  const visible = visiblePanes(layout);
  const index = visible.indexOf(id);
  const previous = index > 0 ? visible[index - 1] : undefined;
  const total = visible.reduce((sum, pane) => sum + weights[pane], 0);
  return {
    open: open[id],
    order: order.indexOf(id),
    weight: weights[id],
    grow: weights[id] / (total || 1),
    previous: previous && { id: previous, weight: weights[previous] },
  };
}

export type WorkspacePanes = ReturnType<typeof useWorkspacePanes>;

/**
 * Chat, changes and the panel are peers: each can be shown, hidden and reordered.
 * Which are open is the thread's own; order and widths are the same everywhere.
 */
export function useWorkspacePanes(thread: string) {
  const [layout, setLayout] = useState<PaneLayout>(() =>
    restoredLayout(thread),
  );
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ order: layout.order, weights: layout.weights }),
    );
  }, [layout.order, layout.weights]);
  useEffect(
    () => remember(layout.thread, layout.open),
    [layout.thread, layout.open],
  );
  // A thread reached without switchTo shows its own panes too. One never
  // seen took over from the last, like a draft once sent, and keeps its panes.
  useLayoutEffect(
    () =>
      setLayout((l) =>
        l.thread === thread
          ? l
          : { ...l, thread, open: recall(thread) ?? l.open },
      ),
    [thread],
  );
  /**
   * Shows the panes `next` had open when it was last on screen, or the chat.
   * A `fresh` thread starts with the chat alone even when it reuses an id.
   */
  const switchTo = useCallback(
    (next: string, fresh = false) =>
      setLayout((l) =>
        fresh
          ? { ...l, thread: next, open: CHAT_ONLY }
          : l.thread === next
            ? l
            : { ...l, thread: next, open: recall(next) ?? CHAT_ONLY },
      ),
    [],
  );
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
  const visible = visiblePanes(layout);
  return { layout, visible, setOpen, show, switchTo, move, resize };
}
