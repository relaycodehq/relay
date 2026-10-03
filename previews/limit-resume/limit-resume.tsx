// The strip on the composer when a usage limit stopped the answer.
// Open http://127.0.0.1:5177/previews/limit-resume/
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import { initAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { LimitStrip } from "../../src/features/thread/WaitingStrip";
import type { LimitResume } from "../../shared/projects";

initAppearance();
initWindowFocus();

const hour = 3_600_000;
const SAMPLES: { label: string; plan: LimitResume }[] = [
  {
    label: "Session limit, resumes later today",
    plan: { messageId: "a", provider: "claude", at: Date.now() + 2 * hour },
  },
  {
    label: "Weekly limit, days out",
    plan: { messageId: "b", provider: "codex", at: Date.now() + 74 * hour },
  },
  {
    label: "Turned off",
    plan: {
      messageId: "c",
      provider: "claude",
      at: Date.now() + 2 * hour,
      off: true,
    },
  },
  {
    label: "Limit lifted, resuming",
    plan: { messageId: "d", provider: "claude", at: Date.now() - 10_000 },
  },
];

function Sample({ label, plan: initial }: (typeof SAMPLES)[number]) {
  const [plan, setPlan] = useState(initial);
  return (
    <section style={{ marginBottom: 28 }}>
      <h3
        style={{
          font: "500 12px system-ui",
          opacity: 0.6,
          margin: "0 0 8px 18px",
        }}
      >
        {label}
      </h3>
      <LimitStrip
        plan={plan}
        onSet={async (on) => {
          await new Promise((r) => setTimeout(r, 300));
          setPlan(({ off, ...rest }) => (on ? rest : { ...rest, off: true }));
        }}
      />
      <div
        style={{
          margin: "0 18px",
          minHeight: 92,
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--toolbar)",
          padding: 14,
          color: "var(--muted, gray)",
          font: "13px system-ui",
        }}
      >
        Ask for follow-up changes
      </div>
    </section>
  );
}

function App() {
  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 12px" }}>
      <p
        style={{
          font: "12px system-ui",
          opacity: 0.55,
          margin: "0 0 24px 18px",
        }}
      >
        Sample data. The buttons work.
      </p>
      {SAMPLES.map((s) => (
        <Sample key={s.label} {...s} />
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
