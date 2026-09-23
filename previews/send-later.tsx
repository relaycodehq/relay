// Send later, on sample data with the app's own styles and controls.
// Open http://127.0.0.1:5177/previews/send-later.html
import "./desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUp, CalendarClock, X } from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/sidebar.css";
import { initAppearance, setMode, useAppearance } from "../src/lib/appearance";
import { SendLaterMenu } from "../src/components/SendLaterMenu";
import { wakeLabel } from "../shared/chat-activity";

initAppearance();

function Preview() {
  const appearance = useAppearance();
  const [draft, setDraft] = useState(
    "Check whether the nightly deploy passed.",
  );
  const [scheduled, setScheduled] = useState<{ body: string; at: number }[]>(
    [],
  );
  return (
    <div className="project-chat" style={{ padding: 32, maxWidth: 720 }}>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Sample data · right-click the send button ·{" "}
        <button
          type="button"
          onClick={() =>
            setMode(appearance.value.mode === "dark" ? "light" : "dark")
          }
        >
          Toggle {appearance.value.mode === "dark" ? "light" : "dark"}
        </button>
      </p>
      <div
        className="sb"
        style={{ width: 280, marginBottom: 24, height: "auto" }}
        aria-label="Sidebar sample"
      >
        <div className="sb-cards">
          <div className="sb-card dim">
            <div className="sb-card-top">
              <span className="sb-card-project">relay</span>
              <span className="sb-card-state scheduled">
                <CalendarClock size={12} />
                Sends {wakeLabel(Date.now() + 3_600_000, new Date())}
              </span>
            </div>
            <div className="sb-card-title">Nightly deploy check</div>
            <div className="sb-card-meta">
              <span className="sb-card-branch">main</span>
            </div>
          </div>
        </div>
        <div className="sb-thread-row">
          <button className="sb-thread">
            <span className="sb-thread-title">Nightly deploy check</span>
            <span
              className="sb-status scheduled"
              title="Sends a scheduled message"
            >
              <CalendarClock size={12} />
            </span>
          </button>
        </div>
      </div>
      {!!scheduled.length && (
        <section className="chat-queue" aria-label="Scheduled messages">
          {scheduled.map((s) => (
            <div key={s.at + s.body} className="queued-message">
              <p>{s.body}</p>
              <footer>
                <span className="queued-status">
                  <CalendarClock size={13} /> Sends{" "}
                  {wakeLabel(s.at, new Date())}
                </span>
                <span className="queued-actions">
                  <button type="button" aria-label="Send now">
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel and return to the composer"
                    onClick={() => {
                      setScheduled((all) => all.filter((o) => o !== s));
                      setDraft(s.body);
                    }}
                  >
                    <X size={14} />
                  </button>
                </span>
              </footer>
            </div>
          ))}
        </section>
      )}
      <form className="project-composer" onSubmit={(e) => e.preventDefault()}>
        <textarea
          aria-label="Message project"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ border: 0 }}
        />
        <div className="composer-tools">
          <span className="spacer" />
          <SendLaterMenu
            disabled={!draft.trim()}
            onPick={(at) => {
              setScheduled((all) => [...all, { body: draft, at }]);
              setDraft("");
            }}
          >
            <button
              className="primary send-message"
              aria-label="Send message"
              title="Send message · right-click to send later"
              disabled={!draft.trim()}
            >
              <ArrowUp size={18} />
            </button>
          </SendLaterMenu>
        </div>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
