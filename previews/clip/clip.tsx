// Clip peeking up at the end of a live turn's thinking line, drawn by the app's own turn
// view and tip. Sample turn; tip memory is this browser's localStorage.
// Open http://127.0.0.1:5177/previews/clip/
import "../_shared/desktop-stub";
import { intro, only } from "./setup";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChatMessage } from "../../shared/projects";
import type { PhoneRemoteState } from "../../shared/remote";
import "../../src/styles.css";
import "../_shared/app-styles";
// The right-click menu borrows the sidebar's menu styles, as in the app.
import "../../src/features/sidebar/sidebar.css";
import {
  initAppearance,
  setMode,
  useAppearance,
} from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { api } from "../../src/lib/api";
import { AgentTurn } from "../../src/features/agent-turn/AgentTurn";
import { TipPeek } from "../../src/features/tips/TipPeek";
import { tips } from "../../src/features/tips/tip-list";

initAppearance();
initWindowFocus();
Object.assign(api, {
  phoneRemoteState: async () =>
    ({ devices: [] }) as unknown as PhoneRemoteState,
});

const root = "/Users/sample/relay";
const step = (n: number, kind: "file" | "read" | "command", label: string) => ({
  kind: "activity" as const,
  id: `s${n}`,
  activity: { id: `s${n}`, kind, label, status: "complete" as const },
});
const message: ChatMessage = {
  id: "sample-turn",
  role: "assistant",
  provider: "claude",
  status: "streaming",
  body: "",
  created: Date.now() - 72_000,
  version: 1,
  trace: [
    step(1, "read", `${root}/src/features/thread/ProjectMessage.tsx`),
    step(2, "file", `${root}/src/features/agent-turn/AgentTurn.tsx`),
    step(3, "command", "npm run typecheck"),
  ],
};

function App() {
  const mode = useAppearance().palette.kind;
  const [chat] = useState(() => `sample-${Date.now()}`);
  return (
    <div style={{ padding: "32px 40px", maxWidth: 820 }}>
      <p className="muted" style={{ fontSize: 12, marginBottom: 24 }}>
        Sample turn ·{" "}
        <button
          type="button"
          onClick={() => setMode(mode === "dark" ? "light" : "dark")}
        >
          {mode === "dark" ? "Light" : "Dark"}
        </button>{" "}
        ·{" "}
        <a href={intro ? "./" : "./?intro"}>
          {intro ? "Returning user" : "First run"}
        </a>{" "}
        ·{" "}
        <select
          value={only ?? ""}
          onChange={(e) =>
            location.assign(e.target.value ? `./?tip=${e.target.value}` : "./")
          }
        >
          <option value="">Whichever tip is next</option>
          {tips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id}
            </option>
          ))}
        </select>
      </p>
      <div className="project-message assistant">
        <AgentTurn
          message={message}
          projectRoot={root}
          onOpenFile={() => {}}
          onChanges={() => {}}
          aside={<TipPeek chatId={chat} message={message} />}
        />
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
