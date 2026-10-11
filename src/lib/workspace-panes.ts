import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type PaneId = "chat" | "changes" | "panel";
const PANE_IDS: PaneId[] = ["chat", "changes", "panel"];
const DEFAULT_WEIGHTS: Record<PaneId, number> = {
  chat: 0.85,
  changes: 1.6,
  panel: 1.4,
};
/**
 * The narrowest each pane gets. Panes that can't all have this much yield,
 * the least recently opened first, rather than run past the window's edge.
 * Changes and the panel each hold a list beside a view, which below 360 px
 * left the view a sliver. All three fit the 1050 px window's minimum once
 * the sidebar steps aside.
 */
export const PANE_MIN: Record<PaneId, number> = {
  chat: 320,
  changes: 360,
  panel: 360,
};
/** The room `panes` need side by side. */
export const roomFor = (panes: PaneId[]) =>
  panes.reduce((sum, id) => sum + PANE_MIN[id], 0);
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
  /** The pane filling the row while the others are hidden, not closed. */
  zoomed?: PaneId;
  /** Every pane, the most recently opened last. */
  recent: PaneId[];
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
  recent: [...PANE_IDS],
});

/** The panes asked for, in order: the zoomed one alone, else every open one. */
export const shownPanes = ({
  order,
  open,
  zoomed,
}: Pick<PaneLayout, "order" | "open" | "zoomed">) =>
  order.filter((id) => (zoomed ? id === zoomed : open[id]));

/**
 * The `shown` panes that fit `room` px side by side. The latest opened goes
 * first, even when nothing fits, then the chat, then the rest from the most
 * recently opened; those left out stay open, off screen, until there's room.
 */
export function fitPanes(shown: PaneId[], recent: PaneId[], room?: number) {
  if (room === undefined || roomFor(shown) <= room) return shown;
  const byRecency = [...recent].reverse().filter((id) => shown.includes(id));
  const [latest, ...rest] = byRecency;
  const kept = new Set<PaneId>();
  let left = room;
  for (const id of new Set<PaneId>([latest, "chat", ...rest])) {
    if (!shown.includes(id) || (kept.size && PANE_MIN[id] > left)) continue;
    kept.add(id);
    left -= PANE_MIN[id];
  }
  return shown.filter((id) => kept.has(id));
}

const bump = (recent: PaneId[], id: PaneId) => [
  ...recent.filter((p) => p !== id),
  id,
];

/** A folder without Git has no changes to show. */
export const panesOf = (order: PaneId[], plain?: boolean) =>
  plain ? order.filter((id) => id !== "changes") : order;

/**
 * Where pane `id` sits in the row: its place in the order and its share of
 * the row, the visible panes' shares adding up to 1 so they always fill it.
 * `previous` is the visible pane before it, which its splitter resizes against.
 */
export function paneFrame(
  layout: Pick<PaneLayout, "order" | "open" | "weights" | "zoomed">,
  id: PaneId,
  visible = shownPanes(layout),
) {
  const { order, weights } = layout;
  const index = visible.indexOf(id);
  const previous = index > 0 ? visible[index - 1] : undefined;
  const total = visible.reduce((sum, pane) => sum + weights[pane], 0);
  return {
    open: visible.includes(id),
    order: order.indexOf(id),
    weight: weights[id],
    grow: weights[id] / (total || 1),
    previous: previous && { id: previous, weight: weights[previous] },
  };
}

/**
 * A ref for the panes' row that keeps `measure` told how wide it is. Hidden
 * behind Settings it measures nothing, and the last width stands.
 */
export function usePaneRow(measure: (width: number) => void) {
  return useCallback(
    (row: HTMLElement | null) => {
      if (!row) return;
      const observer = new ResizeObserver(([entry]) => {
        const width = Math.round(entry.contentRect.width);
        if (width) measure(width);
      });
      observer.observe(row);
      return () => observer.disconnect();
    },
    [measure],
  );
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
  // The row's width, once measured; until then every shown pane fits.
  const [room, setRoom] = useState<number>();
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
          : { ...l, thread, open: recall(thread) ?? l.open, zoomed: undefined },
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
          ? { ...l, thread: next, open: CHAT_ONLY, zoomed: undefined }
          : l.thread === next
            ? l
            : {
                ...l,
                thread: next,
                open: recall(next) ?? CHAT_ONLY,
                zoomed: undefined,
              },
      ),
    [],
  );
  const setOpen = useCallback(
    (id: PaneId, open: boolean) =>
      setLayout((l) => {
        const next = { ...l.open, [id]: open };
        // Never leave the workspace empty: the chat is the fallback pane.
        if (!PANE_IDS.some((p) => next[p])) next.chat = true;
        // Asking for another pane, or closing the zoomed one, ends the zoom.
        const zoomOver = l.zoomed && (id === l.zoomed) !== open;
        return {
          ...l,
          open: next,
          zoomed: zoomOver ? undefined : l.zoomed,
          recent: open ? bump(l.recent, id) : l.recent,
        };
      }),
    [],
  );
  /** Fills the row with `id`, or gives the others their room back. */
  const zoom = useCallback(
    (id: PaneId | undefined) =>
      setLayout((l) =>
        id
          ? {
              ...l,
              zoomed: id,
              open: { ...l.open, [id]: true },
              recent: bump(l.recent, id),
            }
          : { ...l, zoomed: undefined },
      ),
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
  const shown = shownPanes(layout);
  const visible = fitPanes(shown, layout.recent, room);
  return {
    layout,
    /** The panes asked for, whether or not the row has room for them all. */
    shown,
    /** The panes on screen. */
    visible,
    setOpen,
    show,
    zoom,
    switchTo,
    move,
    resize,
    /** Tells the panes how wide their row is. */
    measure: setRoom,
  };
}
