import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SIDEBAR_WIDTH } from "../lib/settings-page";
import { popupOpen, useShortcut } from "../lib/shortcuts";
import { useSidebarAutoHide } from "../lib/sidebar-auto-hide";
import { readText, writeText } from "../lib/persisted-store";

/** How close to the window's left edge the pointer peeks a hidden sidebar. */
const EDGE_PEEK_WIDTH = 12;
const BESIDE_PANE_KEY = "relay-projects-hidden-beside-pane";

export type SidebarVisibility = ReturnType<typeof useSidebarVisibility>;

/**
 * Whether the projects sidebar shows, and its peek while hidden. It
 * remembers two states: beside the chat alone, and beside a side pane (a
 * PR's Review, say). Until toggled there, the latter follows the "make room"
 * setting. While a pane is zoomed it is hidden whatever was chosen, and
 * toggling it ends the zoom instead of changing the choice.
 *
 * `need` is the room the panes beside it need. It narrows to fit them, and
 * when even its narrowest won't fit it steps aside until the window grows
 * or a pane closes. Toggled back meanwhile, it stays and the least recently
 * opened pane steps aside instead.
 */
export function useSidebarVisibility(
  besidePane: boolean,
  zoom: { on: boolean; exit: () => void },
  need: number,
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
  const [hiddenAlone, setHiddenAlone] = useState(
    () => readText("relay-projects-hidden") === "true",
  );
  const [hiddenBesidePane, setHiddenBesidePane] = useState(() => {
    const saved = readText(BESIDE_PANE_KEY);
    return saved ? saved === "true" : null;
  });
  // Asked back while crowded: it stays, and a pane yields instead.
  const [kept, setKept] = useState(false);
  useEffect(() => {
    if (!crowded) setKept(false);
  }, [crowded]);
  const chosenHidden = besidePane
    ? (hiddenBesidePane ?? (autoHide || hiddenAlone))
    : hiddenAlone;
  const hidden = zoom.on || (crowded && !kept) || chosenHidden;
  // While the sidebar is hidden, hovering its toggle peeks it as an overlay.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const peekOpen = () => {
    window.clearTimeout(peekTimer.current);
    if (hidden) setPeek(true);
  };
  const peekClose = () => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(false), 250);
  };
  // Set by the toggle until the next commit, which reads it.
  const toggled = useRef(false);
  const toggle = () => {
    toggled.current = true;
    window.clearTimeout(peekTimer.current);
    setPeek(false);
    if (zoom.on) return zoom.exit();
    const choose = besidePane ? setHiddenBesidePane : setHiddenAlone;
    if (!crowded) return choose(!hidden);
    setKept(hidden);
    if (hidden) choose(false);
  };
  useShortcut("sidebar", true, toggle);
  useEffect(() => {
    writeText("relay-projects-hidden", String(hiddenAlone));
  }, [hiddenAlone]);
  useEffect(() => {
    writeText(
      BESIDE_PANE_KEY,
      hiddenBesidePane === null ? null : String(hiddenBesidePane),
    );
  }, [hiddenBesidePane]);
  // Flipping the setting is a fresh answer for side panes.
  const autoHideWas = useRef(autoHide);
  useEffect(() => {
    if (autoHideWas.current === autoHide) return;
    autoHideWas.current = autoHide;
    setHiddenBesidePane(null);
  }, [autoHide]);
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);
  // Resting the pointer along the window's left edge peeks it too. It's
  // watched rather than covered, so the edge still takes clicks and
  // selections; the short dwell keeps a pointer flung past it, or a drag,
  // from opening it.
  const asideRef = useRef<HTMLElement>(null);
  const edgePeekOn = hidden && !peek;
  useEffect(() => {
    if (!edgePeekOn) return;
    let timer: number | undefined;
    const cancel = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const onMove = (e: MouseEvent) => {
      const top = layout?.getBoundingClientRect().top ?? 0;
      if (e.buttons || e.clientX > EDGE_PEEK_WIDTH || e.clientY < top)
        return cancel();
      timer ??= window.setTimeout(() => {
        if (popupOpen()) return;
        peekFromEdge.current = true;
        setPeek(true);
      }, 150);
    };
    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", cancel);
    return () => {
      cancel();
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", cancel);
    };
  }, [edgePeekOn, layout]);
  // The sidebar slides in under a pointer that hasn't entered it, so its own
  // mouseleave can't close it; until the pointer gets in, leaving the edge does.
  const peekFromEdge = useRef(false);
  useEffect(() => {
    if (!peek || !peekFromEdge.current) return;
    peekFromEdge.current = false;
    const onMove = (e: MouseEvent) => {
      const inside =
        e.target instanceof Node && asideRef.current?.contains(e.target);
      if (!inside && e.clientX <= EDGE_PEEK_WIDTH) return;
      if (!inside) peekClose();
      window.removeEventListener("mousemove", onMove);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [peek]);
  return {
    hidden,
    peek,
    toggle,
    peekOpen,
    peekClose,
    layoutRef: setLayout,
    asideRef,
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
