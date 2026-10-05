import { useEffect, type RefObject } from "react";
import { persistedStore } from "./persisted-store";

/**
 * How wide the reading column grows: the thread, its composer and the
 * new-thread page all follow --thread-width. A per-device preference like the
 * theme; a window narrower than the column still fits it.
 */
export const chatWidths = { min: 720, max: 1600, step: 10, default: 1040 };

/** The chat pane's side padding (.project-messages, .thread-bottom-composer). */
export const THREAD_GUTTER = 56;

const store = persistedStore(
  "relay-chat-width",
  (saved) => {
    const width = Number(saved);
    return saved === null || !Number.isFinite(width)
      ? chatWidths.default
      : Math.min(chatWidths.max, Math.max(chatWidths.min, Math.round(width)));
  },
  (width) => (width === chatWidths.default ? null : String(width)),
);

function apply(width: number) {
  document.documentElement.style.setProperty("--thread-width", `${width}px`);
}

export function initChatWidth() {
  apply(store.get());
}

export function setChatWidth(width: number) {
  store.set(width);
  apply(width);
}

export const useChatWidth = store.use;

/**
 * What sat beside the chat pane when it was last on screen: the sidebar on
 * the left, side panes on the right. Settings hides the pane, so its preview
 * keeps these and lets the window's width change in between. Until a thread
 * has shown, the default sidebar.
 */
let paneInsets = { left: 250, right: 0 };
export const chatPaneInsets = () => paneInsets;

export function useRecordChatPane(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const pane = ref.current;
    if (!pane) return;
    const observer = new ResizeObserver(() => {
      const box = pane.getBoundingClientRect();
      // Hidden behind Settings it measures nothing; keep what it last was.
      if (!box.width) return;
      paneInsets = {
        left: box.left,
        right: document.documentElement.clientWidth - box.right,
      };
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [ref]);
}
