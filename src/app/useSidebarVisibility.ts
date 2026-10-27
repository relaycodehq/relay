import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SIDEBAR_WIDTH } from "../lib/settings-page";
import { useShortcut } from "../lib/shortcuts";
import { useSidebarAutoHide } from "../lib/sidebar-auto-hide";
import { useBarFoldsWithSidebar } from "../lib/activity-bar-folds";
import { readText, writeText } from "../lib/persisted-store";
import {
  chosenHidden,
  sidebarChoiceAfter,
  type SidebarChoice,
} from "./sidebar-choice";
import { useSidebarPeek } from "./useSidebarPeek";

const BESIDE_PANE_KEY = "relay-projects-hidden-beside-pane";

export type SidebarVisibility = ReturnType<typeof useSidebarVisibility>;

/**
 * Whether the projects sidebar shows, and its peek while hidden. The user's
 * hide or show holds everywhere (see sidebarChoiceAfter); beside a side pane
 * the "make room" setting decides until it's chosen there. While a pane is
 * zoomed it is hidden whatever was chosen, and toggling it ends the zoom
 * instead of changing the choice.
 *
 * `need` is the room the panes beside it need. It narrows to fit them, and
 * when even its narrowest won't fit it steps aside until the window grows
 * or a pane closes. Toggled back meanwhile, it stays and the least recently
 * opened pane steps aside instead.
 *
 * The activity bar can fold away with it, and then peeks out with it too.
 */
export function useSidebarVisibility(
  besidePane: boolean,
  zoom: { on: boolean; exit: () => void },
  need: number,
  settingsOpen: boolean,
) {
  const autoHide = useSidebarAutoHide();
  // The sidebar's and the panes' row, measured as one.
  const [layout, setLayout] = useState<HTMLDivElement | null>(null);
  const [room, setRoom] = useState<number>();
  useLayoutEffect(() => {
    if (!layout) return;
    const observer = new ResizeObserver(([entry]) =>
      setRoom(Math.round(entry.contentRect.width)),
    );
    observer.observe(layout);
    return () => observer.disconnect();
  }, [layout]);
  const crowded = !!room && need > room - SIDEBAR_WIDTH.min;
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    if (room && !crowded)
      style.setProperty("--sidebar-room", `${room - need}px`);
    else style.removeProperty("--sidebar-room");
  }, [room, need, crowded]);
  const [choice, setChoice] = useState<SidebarChoice>(() => {
    const besidePane = readText(BESIDE_PANE_KEY);
    return {
      alone: readText("relay-projects-hidden") === "true",
      besidePane: besidePane ? besidePane === "true" : null,
    };
  });
  // Asked back while crowded: it stays, and a pane yields instead.
  const [kept, setKept] = useState(false);
  useEffect(() => {
    if (!crowded) setKept(false);
  }, [crowded]);
  const hidden =
    zoom.on || (crowded && !kept) || chosenHidden(choice, besidePane, autoHide);
  // Settings keeps the bar: its button is the way back.
  const barFolded = useBarFoldsWithSidebar() && hidden && !settingsOpen;
  const peek = useSidebarPeek(hidden, barFolded, layout);
  // Set by the toggle until the next commit, which reads it.
  const toggled = useRef(false);
  const toggle = () => {
    toggled.current = true;
    peek.endPeek();
    if (zoom.on) return zoom.exit();
    const choose = (hide: boolean) =>
      setChoice(sidebarChoiceAfter(hide, besidePane));
    if (!crowded) return choose(!hidden);
    setKept(hidden);
    if (hidden) choose(false);
  };
  useShortcut("sidebar", true, toggle);
  useEffect(() => {
    writeText("relay-projects-hidden", String(choice.alone));
    writeText(
      BESIDE_PANE_KEY,
      choice.besidePane === null ? null : String(choice.besidePane),
    );
  }, [choice]);
  // Flipping the setting is a fresh answer for side panes.
  const autoHideWas = useRef(autoHide);
  useEffect(() => {
    if (autoHideWas.current === autoHide) return;
    autoHideWas.current = autoHide;
    setChoice((choice) => ({ ...choice, besidePane: null }));
  }, [autoHide]);
  return {
    ...peek,
    hidden,
    barFolded,
    toggle,
    layoutRef: setLayout,
    toggled,
  };
}

/**
 * Tells the main window when its sidebar comes or goes, so its minimum width
 * follows. Only the user's own toggle may widen it; Settings, zoom and panes
 * keep its size. A layout effect, so it sees the commit the toggle caused
 * before anything else can render in between.
 */
export function useWindowFitsSidebar(
  shown: boolean,
  toggled: { current: boolean },
) {
  const was = useRef<boolean>(undefined);
  useLayoutEffect(() => {
    if (was.current !== shown)
      void window.relay.setSidebarShown(shown, toggled.current);
    was.current = shown;
    toggled.current = false;
  });
}
