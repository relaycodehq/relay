// A settled thread, opened: three ways to say "you're in a settled thread,
// replying moves it back to Activity".
// Open http://127.0.0.1:5177/previews/settled-notice.html (?v=a|b|c)
import "./desktop-stub";
import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUp, Check, CheckCheck, Moon, Sun } from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "./settled-notice.css";
import { initAppearance, setMode } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";

initAppearance();
initWindowFocus();

type Variant = "a" | "b" | "c";

const variants: { id: Variant; label: string; about: string }[] = [
  {
    id: "a",
    label: "A · Quiet line",
    about: "One muted line under the composer; Unsettle shows on hover.",
  },
  {
    id: "b",
    label: "B · Neutral tab",
    about: "The waiting strip's tab shape, grey instead of accent.",
  },
  {
    id: "c",
    label: "C · Only when typing",
    about: "Placeholder says it; a hint slides in by send once you type.",
  },
];

type Message = { id: number; role: "user" | "assistant"; text: string };

const sample: Message[] = [
  {
    id: 1,
    role: "user",
    text: "The sidebar flickers when a thread finishes. Can you find out why?",
  },
  {
    id: 2,
    role: "assistant",
    text: "Found it: the finished event invalidated the whole chats query, so every row re-mounted. It now patches only the one chat. The flicker is gone and the sidebar spec covers it.",
  },
  { id: 3, role: "user", text: "Nice, thanks. That's all for this one." },
  {
    id: 4,
    role: "assistant",
    text: "Done. Nothing left running on my side.",
  },
];

function Composer({
  variant,
  settled,
  draft,
  setDraft,
  onSend,
}: {
  variant: Variant;
  settled: boolean;
  draft: string;
  setDraft: (text: string) => void;
  onSend: () => void;
}) {
  const typing = !!draft.trim();
  return (
    <form
      className="project-composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <textarea
        className="composer-prompt-input sn-prompt"
        aria-label="Message project"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={
          settled && variant === "c"
            ? "Settled · reply to bring it back to Activity…"
            : "Ask about the code, plan a change, or build something…"
        }
      />
      <div className="composer-tools">
        <button type="button" className="sn-tool">
          Sonnet 5.5
        </button>
        <button type="button" className="sn-tool">
          High
        </button>
        <span className="spacer" />
        {variant === "c" && settled && (
          <span className="settled-hint" data-shown={typing || undefined}>
            <Check size={12} />
            moves it back to Activity
          </span>
        )}
        <button
          className="primary send-message"
          aria-label="Send message"
          disabled={!typing}
        >
          <ArrowUp size={18} />
        </button>
      </div>
    </form>
  );
}

function App() {
  const initial = new URLSearchParams(location.search).get("v");
  const [variant, setVariant] = useState<Variant>(
    initial === "b" || initial === "c" ? initial : "a",
  );
  const [settled, setSettled] = useState(true);
  const [moved, setMoved] = useState(false);
  const [messages, setMessages] = useState(sample);
  const [draft, setDraft] = useState("");
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark" ||
      matchMedia("(prefers-color-scheme: dark)").matches,
  );

  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, variant]);

  const reset = () => {
    setSettled(true);
    setMoved(false);
    setMessages(sample);
    setDraft("");
  };
  const send = () => {
    if (!draft.trim()) return;
    setMessages((all) => [
      ...all,
      { id: all.length + 1, role: "user", text: draft.trim() },
    ]);
    setDraft("");
    if (settled) setMoved(true);
    setSettled(false);
  };
  const pick = (next: Variant) => {
    setVariant(next);
    reset();
    history.replaceState(null, "", `?v=${next}`);
  };

  return (
    <div className="sn-page">
      <div className="sn-bar">
        <span className="sn-sample">Sample data</span>
        <div className="sn-tabs" role="group" aria-label="Design">
          {variants.map((v) => (
            <button
              key={v.id}
              aria-pressed={variant === v.id}
              onClick={() => pick(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="sn-about">
          {variants.find((v) => v.id === variant)!.about}
        </span>
        <button className="sn-tool" onClick={reset}>
          Settle again
        </button>
        <button
          className="sn-tool"
          aria-label="Toggle theme"
          onClick={() => {
            setMode(dark ? "light" : "dark");
            setDark(!dark);
          }}
        >
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
      <div className="sn-chat project-chat">
        <div
          ref={scroller}
          className="project-messages"
          style={{ paddingBottom: 260 }}
        >
          <div className="thread-message-column">
            {messages.map((m) => (
              <article key={m.id} className={`project-message ${m.role}`}>
                <header>
                  <strong>{m.role === "user" ? "You" : "Claude"}</strong>
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
            {variant === "b" && settled && (
              <div className="settled-tab" role="status">
                <CheckCheck size={14} />
                <span className="settled-tab-text">
                  <b>Settled</b>
                  <span> · your next message reopens it in Activity</span>
                </span>
                <button type="button" onClick={() => setSettled(false)}>
                  Unsettle
                </button>
              </div>
            )}
            <Composer
              variant={variant}
              settled={settled}
              draft={draft}
              setDraft={setDraft}
              onSend={send}
            />
            {variant === "a" && settled && (
              <p className="settled-line" role="status">
                <Check size={12} />
                Settled 2h ago · replying moves it back to Activity
                <button type="button" onClick={() => setSettled(false)}>
                  Unsettle
                </button>
              </p>
            )}
            {moved && (
              <p className="sn-moved">
                Sample end state: the thread is back in Activity.&nbsp;
                <button type="button" onClick={reset}>
                  Reset
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
