import { useEffect, useRef, useState } from "react";
import { popupOpen, useShortcut } from "../lib/shortcuts";
import { useSidebarAutoHide } from "../lib/sidebar-auto-hide";

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
 */
export function useSidebarVisibility(
  besidePane: boolean,
  zoom: { on: boolean; exit: () => void },
) {
  const autoHide = useSidebarAutoHide();
  const [hiddenAlone, setHiddenAlone] = useState(
    () => localStorage.getItem("relay-projects-hidden") === "true",
  );
  const [hiddenBesidePane, setHiddenBesidePane] = useState(() => {
    const saved = localStorage.getItem(BESIDE_PANE_KEY);
    return saved ? saved === "true" : null;
  });
  const hidden =
    zoom.on ||
    (besidePane
      ? (hiddenBesidePane ?? (autoHide || hiddenAlone))
      : hiddenAlone);
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
  const toggle = () => {
    window.clearTimeout(peekTimer.current);
    setPeek(false);
    if (zoom.on) return zoom.exit();
    (besidePane ? setHiddenBesidePane : setHiddenAlone)(!hidden);
  };
  useShortcut("sidebar", true, toggle);
  useEffect(() => {
    localStorage.setItem("relay-projects-hidden", String(hiddenAlone));
  }, [hiddenAlone]);
  useEffect(() => {
    if (hiddenBesidePane === null) localStorage.removeItem(BESIDE_PANE_KEY);
    else localStorage.setItem(BESIDE_PANE_KEY, String(hiddenBesidePane));
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
  const layoutRef = useRef<HTMLDivElement>(null);
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
      const top = layoutRef.current?.getBoundingClientRect().top ?? 0;
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
  }, [edgePeekOn]);
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
  return { hidden, peek, toggle, peekOpen, peekClose, layoutRef, asideRef };
}
