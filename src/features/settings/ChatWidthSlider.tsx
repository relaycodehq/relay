import { useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import {
  chatPaneInsets,
  chatWidths,
  setChatWidth,
  THREAD_GUTTER,
  useChatWidth,
} from "../../lib/chat-width";

export function ChatWidthSlider() {
  const width = useChatWidth();
  return (
    <div className="chat-width-slider">
      <input
        type="range"
        min={chatWidths.min}
        max={chatWidths.max}
        step={chatWidths.step}
        aria-label="Chat width"
        value={width}
        onChange={(e) => setChatWidth(Number(e.target.value))}
      />
      <span className="settings-row-value">{width} px</span>
      <button
        type="button"
        className="chat-width-reset"
        title={`Back to ${chatWidths.default} px`}
        aria-label={`Reset chat width to ${chatWidths.default} px`}
        disabled={width === chatWidths.default}
        onClick={() => setChatWidth(chatWidths.default)}
      >
        <RotateCcw size={13} aria-hidden />
      </button>
    </div>
  );
}

const windowWidth = () => document.documentElement.clientWidth;
const onResize = (listener: () => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};

/**
 * The window in miniature: the sidebar, the chat pane with the column in it,
 * and any side panes, as they sat when the thread was last on screen.
 */
export function ChatWidthPreview() {
  const width = useChatWidth();
  const total = useSyncExternalStore(onResize, windowWidth);
  const { left, right } = chatPaneInsets();
  const pane = Math.max(0, total - left - right);
  const column = Math.max(0, Math.min(width, pane - THREAD_GUTTER));
  const share = (px: number, of: number) => `${of ? (px / of) * 100 : 0}%`;
  return (
    <figure className="chat-width-preview">
      <div className="chat-width-window" aria-hidden>
        {left > 0 && (
          <div
            className="chat-width-beside left"
            style={{ width: share(left, total) }}
          />
        )}
        <div className="chat-width-pane">
          <div
            className="chat-width-column"
            style={{ width: share(column, pane) }}
          >
            <span className="chat-width-message" />
            <span className="chat-width-line" />
            <span className="chat-width-line short" />
            <span className="chat-width-composer" />
          </div>
        </div>
        {right > 0 && (
          <div
            className="chat-width-beside right"
            style={{ width: share(right, total) }}
          />
        )}
      </div>
      <figcaption>
        {column < width
          ? `${Math.round(column)} px here: the ${Math.round(pane)} px chat pane is narrower than ${width} px, so the column fills it.`
          : `${width} px column in a ${Math.round(pane)} px chat pane, ${total} px window.`}
      </figcaption>
    </figure>
  );
}
