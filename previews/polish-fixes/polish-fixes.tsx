import "./clock";
import "../_shared/desktop-stub";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/agents/composer-model-picker.css";
import { initAppearance, setMode } from "../../src/lib/appearance";
import { NotesChip } from "../../src/features/notes/NotesChip";
import { QueuedMessages } from "../../src/features/thread/QueuedMessages";
import { PickTime } from "../../src/ui/PickTime";
import { SearchSelect } from "../../src/ui/SearchSelect";
import { TargetField } from "../../src/features/deep-review/TargetField";
import "../../src/features/deep-review/deep-review.css";
import {
  tickNote,
  arrangeNote,
  removeNote,
  type ThreadNote,
} from "../../shared/thread-notes";
import "./audit.css";
initAppearance();
const samples: ThreadNote[] = [
  {
    id: "n1",
    text: "1. Already shipped\n2. Still to investigate",
    done: [0],
    created: 1,
    updated: 1,
  },
];
const body =
  "Please review the selection and keep the existing keyboard controls working. Check the list layout when the panel opens, preserve the wording, and verify that the file picker still shows every matching result. Keep the draft intact while switching between the conversation and the files panel, check both light and dark themes, and show me the final result before changing anything else.";
function Audit() {
  const [view, setView] = useState(
    new URLSearchParams(location.search).get("case") || "queue",
  );
  const [notes, setNotes] = useState(samples);
  const [quoted, setQuoted] = useState("");
  const [wide, setWide] = useState(true);
  const [picked, setPicked] = useState("");
  const [branch, setBranch] = useState("main");
  const [reviewBranch, setReviewBranch] = useState(
    "relay/investigate-why-the-thread-preview-disappears-after-opening-another-window",
  );
  const [key, setKey] = useState(0);
  const options = Array.from({ length: 24 }, (_, i) => ({
    value: i ? "branch-" + i : "main",
    label: i ? "feature/branch-" + i : "main",
  }));
  return (
    <main className="audit-lab">
      <header>
        <span className="audit-eyebrow">
          SAMPLE DATA · CURRENT APP COMPONENTS · 11 OCT 2026
        </span>
        <h1>Relay polish fixes</h1>
        <p>Working fixes using the real components and isolated sample data.</p>
        <nav>
          {["notes", "queue", "time", "picker", "branches"].map((v) => (
            <button key={v} data-on={view === v} onClick={() => setView(v)}>
              {v}
            </button>
          ))}
          <button
            onClick={() =>
              setMode(
                document.documentElement.dataset.theme === "dark"
                  ? "light"
                  : "dark",
              )
            }
          >
            Theme
          </button>
        </nav>
      </header>
      {view === "notes" && (
        <section>
          <h2>Last completed item keeps its checkbox</h2>
          <p>
            Open the pin. Remove only “Still to investigate”, then quote the
            remaining note. It stays completed until you uncheck it.
          </p>
          <button
            onClick={() => {
              setNotes(samples);
              setQuoted("");
            }}
          >
            Reset sample
          </button>
          <div className="note-stage">
            <NotesChip
              notes={{
                notes,
                keep: async () => {},
                tick: (id, n, done) => setNotes(tickNote(notes, id, n, done)),
                arrange: (id, order) => setNotes(arrangeNote(notes, id, order)),
                remove: (id) => setNotes(removeNote(notes, id)),
                kept: () => false,
              }}
              onQuote={setQuoted}
              onJump={() => {}}
            />
          </div>
          <label>
            Quoted into the draft
            <textarea
              readOnly
              value={quoted}
              aria-label="Quoted into the draft"
            />
          </label>
        </section>
      )}
      {view === "queue" && (
        <section>
          <h2>Queue expansion follows the pane width</h2>
          <p>
            Start wide, narrow the pane, then use Show more with a click, Enter
            or Space. The final words should be “before changing anything else.”
          </p>
          <button onClick={() => setWide(!wide)}>
            {wide ? "Narrow pane" : "Widen pane"}
          </button>
          <button
            onClick={() => {
              setWide(true);
              setKey(key + 1);
            }}
          >
            Reset wide
          </button>
          <div className="queue-stage" style={{ width: wide ? 1050 : 744 }}>
            <QueuedMessages
              key={key}
              queue={[
                {
                  input: {
                    id: "q1",
                    body,
                    provider: "codex",
                    choice: {
                      model: "gpt-6.1",
                      fast: false,
                      reasoningEffort: "medium",
                    },
                    runtimeMode: "full-access",
                    interactionMode: "default",
                  },
                  created: 1,
                },
              ]}
              running
              compacting={false}
              busy={false}
              onSteer={() => setPicked("Sample message sent")}
              onMove={() => {}}
              onReturn={() => setPicked(body)}
              onRemove={() => {}}
            />
          </div>
          <output>{picked}</output>
        </section>
      )}
      {view === "time" && (
        <section>
          <h2>Calendar and time stay in sync</h2>
          <p>
            Calendar sample. Use the links below for fixed clocks. The
            daylight-saving reproduction assumes Europe/Prague.
          </p>
          <p>
            <a href="?case=time">Current clock</a> ·{" "}
            <a href="?case=time&amp;clock=month-end">31 October, 23:10</a> ·{" "}
            <a href="?case=time&amp;clock=dst">28 March 2027, 00:10</a> ·{" "}
            <a href="?case=time&amp;clock=fall">31 October 2027, 00:10</a>
          </p>
          <PickTime
            action="Schedule"
            onPick={(n) => setPicked(new Date(n).toString())}
          />
          <output>{picked}</output>
        </section>
      )}
      {view === "picker" && (
        <section>
          <h2>Search stays put while filtering</h2>
          <p>
            The same SearchSelect is used by branches, linked folders and
            Clockify. Try “main”, then clear it.
          </p>
          <div className="picker-stage">
            <SearchSelect
              label="Audit branch"
              value={branch}
              options={options}
              onChange={setBranch}
            />
          </div>
        </section>
      )}
      {view === "branches" && (
        <section>
          <h2>Long branch names in a deep review</h2>
          <p>
            Sample names in the real target field at a 744px conversation width.
          </p>
          <div
            style={{ width: 744, maxWidth: "100%" }}
            className="project-composer"
          >
            <div className="deep-review-setup">
              <TargetField
                project={{
                  id: "sample",
                  name: "Sample project",
                  path: "/sample",
                  repository: null,
                  added: 1,
                }}
                kind="branch"
                branch={reviewBranch}
                changes={0}
                canChoosePR={false}
                onKind={() => {}}
                onBase={setBranch}
                pick={{
                  heads: [reviewBranch, "main"],
                  head: reviewBranch,
                  setHead: setReviewBranch,
                  bases: ["main"],
                  base: branch,
                  branchesPending: false,
                  pull: null,
                  setPull: () => {},
                  commits: [],
                  commitsPending: false,
                  commit: undefined,
                  setCommit: () => {},
                  target: undefined,
                }}
              />
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <Audit />
  </QueryClientProvider>,
);
