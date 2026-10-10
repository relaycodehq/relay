// Queued messages under a running answer: the shipped look and four other ways
// to show what is waiting. Sample thread; ↑ sends a queued message into the
// thread, × returns it to the composer, Reset brings them back.
// Open http://127.0.0.1:5177/previews/queue-looks/ (?look=name)
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowUp, Clock3, X } from "lucide-react";
import type { ProjectChatSend } from "../../shared/projects";
import "../../src/styles.css";
import "../_shared/app-styles";
import "./queue-looks.css";
import {
  initAppearance,
  setMode,
  useAppearance,
} from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { QueuedMessages } from "../../src/features/thread/QueuedMessages";

initAppearance();
initWindowFocus();

type Look = "current" | "tray" | "ghost" | "rail" | "rows";
const looks: { id: Look; label: string; note: string }[] = [
  {
    id: "current",
    label: "Current",
    note: "What ships now: each waiting message is its own dashed card with a status row and two buttons always showing.",
  },
  {
    id: "tray",
    label: "Tray",
    note: "One box for the whole queue, headed Up next with a count. Messages are numbered rows split by hairlines; the buttons show on hover, the shortcut hint sits in the box's foot.",
  },
  {
    id: "ghost",
    label: "Ghost bubbles",
    note: "Same shape as a sent message, drawn fainter: solid border, half-strength fill, softer text. A small caption above each says Next or Then and holds the buttons on hover.",
  },
  {
    id: "rail",
    label: "Rail",
    note: "No boxes. A thin line runs down the right edge into the composer, one dot per waiting message, the first one filled. Reads as a line of people, cheapest on the eye.",
  },
  {
    id: "rows",
    label: "Rows",
    note: "Each message folds to one line with its number; click a row to read it in full. Keeps a long queue short.",
  },
];

type Queued = { id: string; body: string };
const sampleQueue: Queued[] = [
  {
    id: "q1",
    body: "can we do GC safety valve. Kills the last ~34 ms hitch mid-slide. Small job. ?",
  },
  {
    id: "q2",
    body: "QuickJS profiler, then fixing what it finds. These are the big felt ones:\n\n• search typing, 40–63 ms per key;\n• the first entry into a tab, about 60 ms;\n• L1 presses, 45 ms each.\nI think search alone is the most noticeable lag left.",
  },
  {
    id: "q3",
    body: "and bump the frame budget note in docs/perf.md once you're done",
  },
];

const params = new URLSearchParams(location.search);

function Hint() {
  return (
    <p className="chat-queue-hint">
      <kbd>⌘↵</kbd> to queue · <kbd>↵</kbd> to steer · <kbd>⌥↑</kbd> to edit
      the last
    </p>
  );
}

function Actions({ onSend, onReturn }: { onSend(): void; onReturn(): void }) {
  return (
    <span className="queued-actions">
      <button
        type="button"
        aria-label="Steer now"
        title="Steer the current answer, or send this next when it can't be steered"
        onPointerDown={(e) => e.preventDefault()}
        onClick={onSend}
      >
        <ArrowUp size={14} />
      </button>
      <button
        type="button"
        aria-label="Cancel and return to the composer"
        title="Cancel and return to the composer"
        onPointerDown={(e) => e.preventDefault()}
        onClick={onReturn}
      >
        <X size={14} />
      </button>
    </span>
  );
}

type LookProps = {
  queue: Queued[];
  send(id: string): void;
  back(id: string): void;
};

function Tray({ queue, send, back }: LookProps) {
  return (
    <section className="ql-tray" aria-label="Queued messages">
      <header>
        <Clock3 size={13} /> Up next <span>{queue.length}</span>
      </header>
      <ol>
        {queue.map((q, i) => (
          <li key={q.id}>
            <i>{i + 1}</i>
            <p>{q.body}</p>
            <Actions onSend={() => send(q.id)} onReturn={() => back(q.id)} />
          </li>
        ))}
      </ol>
      <footer>
        <Hint />
      </footer>
    </section>
  );
}

function Ghost({ queue, send, back }: LookProps) {
  return (
    <section className="ql-ghost" aria-label="Queued messages">
      {queue.map((q, i) => (
        <div className="ql-ghost-item" key={q.id}>
          <div className="ql-cap">
            <Actions onSend={() => send(q.id)} onReturn={() => back(q.id)} />
            <span>{i === 0 ? "Next" : "Then"}</span>
          </div>
          <div className="ql-bubble">{q.body}</div>
        </div>
      ))}
      <Hint />
    </section>
  );
}

function Rail({ queue, send, back }: LookProps) {
  return (
    <section className="ql-rail" aria-label="Queued messages">
      <ol>
        {queue.map((q, i) => (
          <li key={q.id}>
            <div className="ql-cap">
              <Actions onSend={() => send(q.id)} onReturn={() => back(q.id)} />
              <span>{i === 0 ? "next" : "then"}</span>
            </div>
            <p>{q.body}</p>
          </li>
        ))}
      </ol>
      <Hint />
    </section>
  );
}

function Rows({ queue, send, back }: LookProps) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="ql-rows" aria-label="Queued messages">
      {queue.map((q, i) => (
        <div
          className="ql-row"
          key={q.id}
          data-open={open === q.id || undefined}
          onClick={() => setOpen(open === q.id ? null : q.id)}
        >
          <i>{i + 1}</i>
          <p>{q.body}</p>
          <Actions onSend={() => send(q.id)} onReturn={() => back(q.id)} />
        </div>
      ))}
      <Hint />
    </section>
  );
}

function App() {
  const mode = useAppearance().palette.kind;
  const [look, setLook] = useState<Look>(
    looks.find((l) => l.id === params.get("look"))?.id ?? "tray",
  );
  const [queue, setQueue] = useState(sampleQueue);
  const [sent, setSent] = useState<Queued[]>([]);
  const [draft, setDraft] = useState("");
  const send = (id: string) => {
    const q = queue.find((q) => q.id === id);
    if (!q) return;
    setQueue(queue.filter((q) => q.id !== id));
    setSent([...sent, q]);
  };
  const back = (id: string) => {
    const q = queue.find((q) => q.id === id);
    if (!q) return;
    setQueue(queue.filter((q) => q.id !== id));
    setDraft(q.body);
  };
  const reset = () => {
    setQueue(sampleQueue);
    setSent([]);
    setDraft("");
  };
  const asSends = queue.map((q) => ({
    input: { id: q.id, body: q.body } as ProjectChatSend,
    created: Date.now(),
  }));
  const props = { queue, send, back };
  return (
    <div className={`ql-page look-${look}`}>
      <p className="muted ql-bar">
        Sample thread ·{" "}
        {looks.map((l) => (
          <button
            key={l.id}
            type="button"
            className={l.id === look ? "selected" : undefined}
            onClick={() => {
              setLook(l.id);
              history.replaceState(null, "", `?look=${l.id}`);
            }}
          >
            {l.label}
          </button>
        ))}{" "}
        ·{" "}
        <button type="button" onClick={reset}>
          Reset
        </button>{" "}
        ·{" "}
        <button
          type="button"
          onClick={() => setMode(mode === "dark" ? "light" : "dark")}
        >
          {mode === "dark" ? "Light" : "Dark"}
        </button>
      </p>
      <p className="muted ql-note">{looks.find((l) => l.id === look)!.note}</p>

      <div className="ql-thread">
        <div className="project-message user">
          <div className="markdown">
            <p>
              the slide-in on the Settings tab still hitches on the Fold.
              what's left?
            </p>
          </div>
        </div>
        <div className="project-message assistant">
          <div className="markdown">
            <p>
              Profiling the slide first. The GC pause shows up in the trace
              every third frame, so the hitch is the collector, not layout.
              Reading the tab code to see where the garbage comes from.
            </p>
          </div>
          <p className="muted ql-live">Reading src/ui/tabs.ts…</p>
        </div>
        {sent.map((q) => (
          <div className="project-message user" key={q.id}>
            <div className="markdown">
              <p style={{ whiteSpace: "pre-wrap" }}>{q.body}</p>
            </div>
          </div>
        ))}

        {look === "current" && (
          <QueuedMessages
            queue={asSends}
            running
            compacting={false}
            busy={false}
            onSteer={send}
            onMove={() => {}}
            onReturn={(input) => back(input.id)}
            onRemove={(id) => setQueue(queue.filter((q) => q.id !== id))}
          />
        )}
        {look === "tray" && !!queue.length && <Tray {...props} />}
        {look === "ghost" && !!queue.length && <Ghost {...props} />}
        {look === "rail" && !!queue.length && <Rail {...props} />}
        {look === "rows" && !!queue.length && <Rows {...props} />}

        <div className="project-composer ql-composer">
          <p className={draft ? undefined : "muted"}>
            {draft || "Message Relay…"}
          </p>
        </div>
      </div>
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
