// A rail of one tick per prompt beside the thread: hover for the prompt and
// how its answer starts, click to jump there. The lens look was chosen.
// Open http://127.0.0.1:5177/previews/thread-timeline/
import "../_shared/desktop-stub";
import { StrictMode, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowUp, Rows3 } from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/sidebar/sidebar.css";
import "../_shared/chrome.css";
import "./thread-timeline.css";
import {
  initAppearance,
  setMode,
  useAppearance,
} from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { Message } from "../../src/features/thread/ProjectMessage";
import { useThreadScroll } from "../../src/features/thread/useThreadScroll";
import { ThreadTimeline } from "../../src/features/thread/ThreadTimeline";
import { projectRoot, sampleThread } from "./thread-timeline-data";

initAppearance();
initWindowFocus();

const threads = [
  "Phone bridge and the timeline",
  "Read aloud: Supertonic",
  "Worktree bootstrap",
  "Fix flaky worktrees spec",
];

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="preview-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function App() {
  const appearance = useAppearance();
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>
          <Rows3 size={14} /> Thread timeline
        </strong>
        <span className="preview-tag">Preview · sample data</span>
        <span className="spacer" />
        <Segmented<string>
          label="Colour mode"
          value={appearance.palette.kind}
          onChange={(v) => setMode(v as "light" | "dark")}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <span className="tl-note">
          The rail hides until the pointer comes to the thread's left edge;
          ticks around the pointer widen, the turn you're reading stays lit.
          Click a tick to jump; ↑/↓ and Enter work once the rail has focus.
        </span>
      </div>
      <div className="tl-body">
        <aside className="tl-sidebar">
          <div className="sb">
            <div className="tl-sb-project">relay</div>
            <div className="sb-thread-list flat">
              {threads.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  className={`sb-thread${i === 0 ? " selected" : ""}`}
                >
                  <span className="sb-thread-title">{t}</span>
                  <time className="sb-age">{["now", "2h", "5h", "1d"][i]}</time>
                </button>
              ))}
            </div>
          </div>
        </aside>
        <div className="project-chat-pane">
          <Thread />
        </div>
      </div>
    </div>
  );
}

function Thread() {
  const view = useThreadScroll({
    place: "preview",
    rootId: null,
    messages: sampleThread,
    shown: sampleThread,
    opened: true,
    isEmpty: false,
  });
  return (
    <section
      className="project-chat"
      aria-label="Project chat"
      style={
        { "--composer-dock-height": `${view.dockHeight}px` } as CSSProperties
      }
    >
      <div
        className="project-messages"
        ref={view.scroll}
        onScroll={view.onScroll}
      >
        <div className="thread-message-column" ref={view.column}>
          {view.earlier && (
            <button className="load-more" onClick={view.showEarlier}>
              Earlier messages
            </button>
          )}
          {sampleThread.slice(-view.visible).map((m) => (
            <Message
              key={m.id}
              message={m}
              chatId=""
              onReply={() => {}}
              onFork={() => {}}
              onChanges={() => {}}
              onTurnDiff={() => {}}
              onRewind={async () => ({ conflicts: [] })}
              projectRoot={projectRoot}
              onOpenFile={() => {}}
            />
          ))}
        </div>
      </div>
      <ThreadTimeline
        listed={sampleThread}
        scroll={view.scroll}
        bottomInset={view.dockHeight}
        onJump={view.jumpTo}
      />
      <div
        ref={view.composerDock}
        className={`thread-bottom-composer${view.scrolledUp ? " collapsed" : ""}`}
      >
        <div className="thread-compose-wrap">
          <form
            className="project-composer"
            onSubmit={(e) => e.preventDefault()}
          >
            <textarea
              className="composer-prompt-input"
              aria-label="Message Claude"
              placeholder="Ask Claude anything… (sending is off in the preview)"
            />
            <div className="composer-tools">
              <span className="spacer" />
              <button type="submit" className="send-message" aria-label="Send">
                <ArrowUp size={16} />
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
