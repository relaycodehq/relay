import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { api } from "../../lib/api";
import { legacyTabs } from "../../lib/workspace-panes";
import { newTerminalSlot } from "../terminal/terminal-dock";

/** What the panel can show. Terminals stack as several tabs; the rest open once. */
export type Surface = "files" | "history" | "terminal" | "browser" | "device";
const SURFACES: Surface[] = ["files", "history", "terminal", "browser", "device"];

export interface PanelTab {
  key: string;
  surface: Surface;
  /** A terminal tab's shell, one of the thread's. */
  slot?: string;
}
interface PanelState {
  thread: string;
  tabs: PanelTab[];
  /** The tab in front; null shows the picker. */
  front: string | null;
  /** A tab the agent opened that the user hasn't looked at yet. */
  unseen?: string | null;
}

const STORAGE_KEY = "relay-thread-panel";
const REMEMBERED = 200;

function tabFor(surface: Surface): PanelTab {
  if (surface !== "terminal") return { key: surface, surface };
  const slot = newTerminalSlot();
  return { key: `terminal:${slot}`, surface, slot };
}

const isTab = (tab: unknown): tab is PanelTab =>
  typeof (tab as PanelTab)?.key === "string" &&
  SURFACES.includes((tab as PanelTab).surface) &&
  ((tab as PanelTab).surface !== "terminal" ||
    typeof (tab as PanelTab).slot === "string");

/** The panel's tabs per thread, least recently used first. */
const byThread = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return new Map<string, Omit<PanelState, "thread">>(
      Array.isArray(saved)
        ? saved
            .filter(
              (entry): entry is [string, Omit<PanelState, "thread">] =>
                Array.isArray(entry) &&
                typeof entry[0] === "string" &&
                Array.isArray(entry[1]?.tabs),
            )
            .map(([thread, { tabs, front, unseen }]) => {
              const kept = tabs.filter(isTab);
              const has = (key?: string | null) =>
                kept.some((t) => t.key === key);
              return [
                thread,
                {
                  tabs: kept,
                  front: has(front) ? front : null,
                  unseen: has(unseen) ? unseen : null,
                },
              ];
            })
        : [],
    );
  } catch {
    return new Map<string, Omit<PanelState, "thread">>();
  }
})();

function remember({ thread, tabs, front, unseen }: PanelState) {
  if (!thread) return;
  byThread.delete(thread);
  byThread.set(thread, { tabs, front, unseen });
  for (const oldest of byThread.keys()) {
    if (byThread.size <= REMEMBERED) break;
    byThread.delete(oldest);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...byThread]));
  } catch {
    // Still remembered for this session.
  }
}

/** The thread's own tabs; Files and History it had open as panes before the panel. */
function recall(thread: string): Omit<PanelState, "thread"> | undefined {
  const saved = byThread.get(thread);
  if (saved) return saved;
  const legacy = legacyTabs(thread);
  if (!legacy.length) return;
  const tabs = legacy.map(tabFor);
  return { tabs, front: tabs[tabs.length - 1]!.key, unseen: null };
}

/** A Browser tab for the thread, in front only when nothing else is, and unseen. */
function withBrowser(s: Omit<PanelState, "thread">) {
  const had = s.tabs.find((t) => t.surface === "browser");
  const tab = had ?? tabFor("browser");
  return {
    tabs: had ? s.tabs : [...s.tabs, tab],
    front: s.front ?? tab.key,
    unseen: tab.key,
  };
}

/** The mounted panels, by thread, so a reveal reaches the one on screen. */
const mounted = new Map<string, () => void>();
let revealing = false;
/** An agent opened its thread's preview: the thread gets a Browser tab. */
function followReveals() {
  if (revealing) return;
  revealing = true;
  api.onPreviewReveal(({ chatId }) => {
    const live = mounted.get(chatId);
    if (live) return live();
    const saved = recall(chatId) ?? { tabs: [], front: null };
    remember({ thread: chatId, ...withBrowser(saved) });
  });
}

export type PanelTabs = ReturnType<typeof usePanelTabs>;

/**
 * Which surfaces the thread's panel has open as tabs, and which is in front.
 * A thread never seen keeps the tabs on screen, like a draft once sent.
 * `shown`: the panel is open, so the tab in front counts as seen.
 */
export function usePanelTabs(thread: string, shown: boolean) {
  const [state, setState] = useState<PanelState>(() => ({
    thread,
    ...(recall(thread) ?? { tabs: [], front: null }),
  }));
  useLayoutEffect(
    () =>
      setState((s) =>
        s.thread === thread ? s : { ...s, thread, ...recall(thread) },
      ),
    [thread],
  );
  useEffect(() => remember(state), [state]);
  const seen = shown && !!state.unseen && state.unseen === state.front;
  useEffect(() => {
    if (seen) setState((s) => ({ ...s, unseen: null }));
  }, [seen]);
  useEffect(() => {
    followReveals();
    const reveal = () => setState((s) => ({ ...s, ...withBrowser(s) }));
    mounted.set(thread, reveal);
    return () => {
      if (mounted.get(thread) === reveal) mounted.delete(thread);
    };
  }, [thread]);
  /** Brings the surface's tab to the front, opening it; a terminal always opens a new one. */
  const show = useCallback(
    (surface: Surface) =>
      setState((s) => {
        const had = s.tabs.find((t) => t.surface === surface);
        if (had && surface !== "terminal") return { ...s, front: had.key };
        const tab = tabFor(surface);
        return { ...s, tabs: [...s.tabs, tab], front: tab.key };
      }),
    [],
  );
  const bring = useCallback(
    (key: string) => setState((s) => ({ ...s, front: key })),
    [],
  );
  /** Shows the picker to open one more. */
  const pick = useCallback(() => setState((s) => ({ ...s, front: null })), []);
  const close = useCallback(
    (key: string) =>
      setState((s) => {
        const at = s.tabs.findIndex((t) => t.key === key);
        const tabs = s.tabs.filter((t) => t.key !== key);
        return {
          ...s,
          tabs,
          front:
            s.front === key
              ? (tabs[Math.min(at, tabs.length - 1)]?.key ?? null)
              : s.front,
          unseen: s.unseen === key ? null : s.unseen,
        };
      }),
    [],
  );
  return {
    tabs: state.tabs,
    front: state.tabs.find((t) => t.key === state.front) ?? null,
    /** The tab the agent opened that the user hasn't looked at yet. */
    unseen: seen ? null : (state.unseen ?? null),
    has: (surface: Surface) => state.tabs.some((t) => t.surface === surface),
    show,
    bring,
    pick,
    close,
  };
}
