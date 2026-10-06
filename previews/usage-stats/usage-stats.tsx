// The Usage page as it ships, on a made-up six weeks.
// Open http://127.0.0.1:5177/previews/usage-stats/
import "../_shared/desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChartColumn, GitPullRequest } from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/sidebar/sidebar.css";
import "../_shared/chrome.css";
import "./preview.css";
import {
  initAppearance,
  setMode,
  useAppearance,
} from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import type { Api } from "../../shared/types";
import { UsagePage } from "../../src/features/usage/UsagePage";
import { sampleSummary } from "./usage-data";

initAppearance();
initWindowFocus();

Object.assign(window.relay, {
  usageSummary: async (range) => sampleSummary(range),
  writeClipboardImage: async () => {},
  saveUsageImage: async (png, name) => {
    const a = document.createElement("a");
    a.href = png;
    a.download = name;
    a.click();
    return name;
  },
} satisfies Partial<Api>);

function App() {
  const kind = useAppearance().palette.kind;
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>
          <ChartColumn size={14} /> Usage page
        </strong>
        <span className="preview-tag">Preview · sample data</span>
        <span className="spacer" />
        <div
          className="preview-segmented"
          role="radiogroup"
          aria-label="Colour mode"
        >
          {(["light", "dark"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setMode(k)}
            >
              {k === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside className="preview-usage-sidebar">
          <div className="sb">
            <nav className="sb-nav">
              <button className="sb-nav-item">
                <GitPullRequest size={15} />
                Pull requests
              </button>
              <button className="sb-nav-item selected" aria-current="page">
                <ChartColumn size={15} />
                Usage
              </button>
            </nav>
          </div>
        </aside>
        <UsagePage />
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
