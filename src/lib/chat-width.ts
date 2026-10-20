import { useEffect, type RefObject } from "react";
import { fileSetting, storedBefore } from "./settings-file";

/**
 * How wide the reading column grows: the thread, its composer and the
 * new-thread page all follow --thread-width. Kept in settings.json; a window
 * narrower than the column still fits it.
 */
export const chatWidths = { min: 800, max: 1600, step: 10, default: 1040 };

/** The chat pane's side padding (.project-messages, .thread-bottom-composer). */
export const THREAD_GUTTER = 100;

const clamp = (width: number) =>
  Math.min(chatWidths.max, Math.max(chatWidths.min, Math.round(width)));

const store = fileSetting<number>({
  path: ["chat", "width"],
  parse: (saved) =>
    typeof saved === "number" && Number.isFinite(saved)
      ? clamp(saved)
      : chatWidths.default,
  serialize: (width) => (width === chatWidths.default ? undefined : width),
  legacy: storedBefore("relay-chat-width", (raw) => {
    const width = Number(raw);
    return Number.isFinite(width) ? clamp(width) : undefined;
  }),
});

function apply(width: number) {
  document.documentElement.style.setProperty("--thread-width", `${width}px`);
}

store.subscribe(() => apply(store.get()));

export function initChatWidth() {
  apply(store.get());
}

export function setChatWidth(width: number) {
  store.set(width);
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
