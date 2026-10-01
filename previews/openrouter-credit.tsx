// OpenCode on an OpenRouter model shows dollars left instead of a usage ring.
// Open http://127.0.0.1:5177/previews/openrouter-credit.html
import "./desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import "../src/components/composer-model-picker.css";
import { initAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import { OpenRouterCreditButton } from "../src/components/OpenRouterCredit";
import { UsageRing } from "../src/components/UsageRing";
import type { OpenRouterCredit } from "../shared/openrouter-credit";

initAppearance();
initWindowFocus();

const SAMPLES: Record<string, OpenRouterCredit> = {
  "Low balance (hot)": {
    balance: 3.05,
    limit: { amount: 50, remaining: 45.29, reset: "monthly" },
    spent: { day: 4.71, week: 4.71, month: 4.71 },
    message: null,
  },
  Healthy: {
    balance: 182.4,
    limit: null,
    spent: { day: 1.2, week: 9.8, month: 31.5 },
    message: null,
  },
  "Key cap binds (warn)": {
    balance: 640,
    limit: { amount: 20, remaining: 6.4, reset: "daily" },
    spent: { day: 2.1, week: 7.9, month: 13.6 },
    message: null,
  },
  "Out of credit": {
    balance: 0,
    limit: null,
    spent: { day: 3.3, week: 12, month: 40 },
    message: null,
  },
};

let sample = Object.keys(SAMPLES)[0]!;
(window.relay as unknown as Record<string, unknown>).openRouterCredit =
  async () => SAMPLES[sample];

function App() {
  const [pick, setPick] = useState(sample);
  return (
    <div style={{ maxWidth: 560, margin: "28px auto", padding: "0 26px" }}>
      <p style={{ color: "var(--muted)", fontSize: 11 }}>
        Sample data · hover the dollar amount
      </p>
      <div style={{ display: "flex", gap: 6, marginBottom: 180 }}>
        {Object.keys(SAMPLES).map((name) => (
          <button
            key={name}
            type="button"
            className="secondary-button"
            aria-pressed={pick === name}
            onClick={() => {
              sample = name;
              setPick(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 24 }}>
        <div className="composer-tools model-field" key={pick}>
          <OpenRouterCreditButton threadCost={0.4218} />
        </div>
        <div className="composer-tools model-field">
          <UsageRing provider="claude" />
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
