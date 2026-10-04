// "Flag what I'd miss": the side check's notes in the turn they're about,
// drawn by the app's own WatchNotes on sample data. The setting that turns
// it on lives in Settings → Agents and is off by default.
// Open http://127.0.0.1:5177/previews/watcher-notes/
import "../_shared/desktop-stub";
import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowUp, Moon, Sun } from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/settings/settings.css";
import "./watcher-notes.css";
import { initAppearance, setMode } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { AgentTurn } from "../../src/features/agent-turn/AgentTurn";
import { WatchNotes } from "../../src/features/watch/WatchNotes";
import { WatchThreadsSetting } from "../../src/features/settings/WatchThreadsSetting";
import type { WatchNote } from "../../shared/watch";
import { notes, projectRoot, turn, userAsk } from "./watcher-data";

initAppearance();
initWindowFocus();

const sample = (): WatchNote[] =>
  notes.map((n, i) => ({
    id: `${n.id}-${Date.now()}`,
    tag: n.tag,
    line: n.line,
    title: n.title,
    points: n.points,
    ...(n.diff ? { diff: n.diff } : {}),
    steer: n.steer,
    ...(n.sourceId ? { agent: { id: n.sourceId, label: n.source } } : {}),
    created: Date.now() - (notes.length - i) * 60_000,
  }));

type Sent = { id: number; text: string };

/** The entry as Settings → Agents draws it. */
function SettingView() {
  return (
    <div className="wn-settings">
      <section className="setting block" aria-label="Flag what I'd miss">
        <div className="setting-text">
          <h4>Flag what I'd miss</h4>
          <p>
            A side check reads along and points out what you'd likely miss, like
            a subagent changing a test to make it pass, or a tradeoff mentioned
            in passing. Notes show in the turn they're about. Claude threads
            only.
          </p>
        </div>
        <div className="setting-control">
          <WatchThreadsSetting />
        </div>
      </section>
    </div>
  );
}

function App() {
  const [view, setView] = useState<"thread" | "setting">(
    new URLSearchParams(location.search).get("view") === "setting"
      ? "setting"
      : "thread",
  );
  // A new key remounts the notes, so closed ones come back.
  const [round, setRound] = useState(0);
  const [shown, setShown] = useState(sample);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<Sent[]>([]);
  const [now] = useState(() => Date.now());
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark" ||
      matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [round, sent.length]);

  const send = () => {
    if (!draft.trim()) return;
    setSent((all) => [...all, { id: all.length + 1, text: draft.trim() }]);
    setDraft("");
  };

  return (
    <div className="wn-page">
      <div className="wn-bar">
        <span className="wn-sample">Sample data</span>
        <div className="wn-tabs" role="group" aria-label="View">
          {(["thread", "setting"] as const).map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
                history.replaceState(
                  null,
                  "",
                  v === "setting" ? "?view=setting" : "?",
                );
              }}
            >
              {v === "thread" ? "Thread" : "Setting"}
            </button>
          ))}
        </div>
        <span className="wn-about">
          The app's WatchNotes, as a Claude thread shows them with Settings →
          Agents → Flag what I'd miss on "With subagents".
        </span>
        <button
          className="wn-tool"
          onClick={() => {
            setShown(sample());
            setRound(round + 1);
            setSent([]);
            setDraft("");
          }}
        >
          Bring notes back
        </button>
        <button
          className="wn-tool"
          aria-label="Toggle theme"
          onClick={() => {
            setMode(dark ? "light" : "dark");
            setDark(!dark);
          }}
        >
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
      {view === "setting" ? (
        <SettingView />
      ) : (
        <div className="wn-chat project-chat">
          <div className="thread-subheader wn-subheader">
            <span className="wn-thread-title">Fix flaky checkout tests</span>
          </div>
          <div
            ref={scroller}
            className="project-messages"
            style={{ paddingBottom: 280 }}
          >
            <div className="thread-message-column">
              <article className="project-message user">
                <header>
                  <strong>You</strong>
                </header>
                <div className="markdown">
                  <p>{userAsk}</p>
                </div>
              </article>
              <article className="project-message assistant">
                <header>
                  <strong>Claude</strong>
                </header>
                <AgentTurn
                  message={turn(now)}
                  projectRoot={projectRoot}
                  onOpenFile={() => {}}
                  onChanges={() => {}}
                />
                <WatchNotes
                  key={round}
                  chatId="sample-chat"
                  messageId="turn"
                  notes={shown}
                  projectRoot={projectRoot}
                  onOpenFile={() => {}}
                  onSteer={(text) => {
                    setDraft((old) => `${old}${old ? "\n\n" : ""}${text}`);
                    requestAnimationFrame(() => input.current?.focus());
                  }}
                />
              </article>
              {sent.map((m) => (
                <article key={m.id} className="project-message user">
                  <header>
                    <strong>You</strong>
                  </header>
                  <div className="markdown">
                    <p>{m.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className="thread-bottom-composer">
            <div className="composer-dock">
              <form
                className="project-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <textarea
                  ref={input}
                  className="composer-prompt-input wn-prompt"
                  aria-label="Message project"
                  value={draft}
                  rows={draft ? 3 : 1}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Steer Claude while it works…"
                />
                <div className="composer-tools">
                  <span className="spacer" />
                  <button
                    className="primary send-message"
                    aria-label="Send message"
                    disabled={!draft.trim()}
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
