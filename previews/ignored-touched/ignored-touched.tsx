// The Changes pane listing gitignored files agents wrote (inline, option C),
// drawn by the app's own LocalChanges on sample data.
// Open http://127.0.0.1:5177/previews/ignored-touched/
import "../_shared/desktop-stub";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../_shared/chrome.css";
import "../../src/features/sidebar/sidebar.css";
import { initAppearance, setMode } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { LocalChanges } from "../../src/features/changes/LocalChanges";
import type { IgnoredTouch, WorkingTree } from "../../shared/working-tree";
import { changes, pairFor, touched, trackedPair } from "./ignored-data";

initAppearance();
initWindowFocus();

let dismissed = new Set<string>();
const listed = (): IgnoredTouch[] =>
  touched
    .filter((t) => !dismissed.has(t.path))
    .map((t) => ({
      path: t.path,
      agent: t.by.startsWith("Codex") ? "codex" : "claude",
      before: t.before === null ? "none" : "kept",
      rule: `${t.rule.source}:${t.rule.line} ${t.rule.pattern}`,
    }));
const tree = (): WorkingTree => ({
  head: "4edf04d",
  branch: "invoice-lines",
  revision: String(dismissed.size),
  changes,
  upstream: "origin/invoice-lines",
  ahead: 0,
  behind: 0,
  pushTarget: "origin/invoice-lines",
  pushUrl: null,
  operation: null,
  lines: { additions: 64, deletions: 9 },
  outgoing: [],
  ignored: listed(),
});
Object.assign(window.relay, {
  projectWorkingTree: async () => tree(),
  projectWorkingDiff: async (_: string, path: string) => trackedPair(path),
  projectIgnoredDiff: async (_: string, path: string) =>
    pairFor(touched.find((t) => t.path === path)!),
  projectDismissIgnored: async (_: string, paths: string[]) => {
    dismissed = new Set([...dismissed, ...paths]);
    return tree();
  },
});

function Preview() {
  const [dark, setDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => setMode(dark ? "dark" : "light"), [dark]);
  return (
    <div className="preview-app">
      <div className="preview-bar">
        <strong>Changes · gitignored files agents wrote</strong>
        <span className="preview-tag">Sample data</span>
        <span>Right-click an eye-off row to dismiss it.</span>
        <button
          className="text-button"
          onClick={() => {
            dismissed = new Set();
            location.reload();
          }}
        >
          Reset
        </button>
        <span className="preview-segmented" role="radiogroup" aria-label="Theme">
          <button role="radio" aria-checked={!dark} onClick={() => setDark(false)}>
            Light
          </button>
          <button role="radio" aria-checked={dark} onClick={() => setDark(true)}>
            Dark
          </button>
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <LocalChanges projectId="sample" onOpenFile={() => {}} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
