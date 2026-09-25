// The default agent setting and the new-thread composers that follow it.
// Open http://127.0.0.1:5177/previews/default-agent.html
import "./desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";
import "../src/components/projects.css";
import { initAppearance } from "../src/lib/appearance";
import { Settings } from "../src/components/Settings";
import { ProjectComposer } from "../src/components/ProjectComposer";
import { defaultAISettings, type AISettings } from "../shared/settings";
import type { Api } from "../shared/types";

initAppearance();

// Sample storage: one project never picked an agent, one saved Codex before
// picks were told apart, one picked Codex.
localStorage.setItem(
  "composer-settings:new:legacy",
  JSON.stringify({ provider: "codex" }),
);
localStorage.setItem(
  "composer-settings:new:picked",
  JSON.stringify({ agent: "codex" }),
);
localStorage.removeItem("composer-settings:new:fresh");

let aiSettings: AISettings = defaultAISettings;
Object.assign(window.relay as Partial<Api>, {
  // Slow on purpose: composers mount before the setting arrives, like after launch.
  aiSettings: () =>
    new Promise<AISettings>((r) => setTimeout(() => r(aiSettings), 600)),
  saveAISettings: async (next: AISettings) => (aiSettings = next),
  updateState: async () => ({ status: "off", current: "preview" }),
  claudeDefaults: async () => null,
  codexDefaults: async () => ({ model: "", effort: "" }),
});

const queryClient = new QueryClient();
const projects = [
  ["fresh", "Never picked an agent"],
  ["legacy", "Saved Codex before picks were told apart"],
  ["picked", "Picked Codex"],
] as const;

function Preview() {
  const [open, setOpen] = useState(true);
  return (
    <div className="project-chat" style={{ padding: 32, maxWidth: 820 }}>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Sample data ·{" "}
        <button type="button" onClick={() => setOpen(true)}>
          Open settings
        </button>
      </p>
      {projects.map(([id, label]) => (
        <section key={id} data-project={id} style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 13 }}>{label}</h3>
          <ProjectComposer
            settingsKey={`new:${id}`}
            draftKey={`preview-draft:${id}`}
            onCommand={() => false}
            onDraft={() => {}}
            shared={false}
            running={false}
            busy={false}
            projectId={id}
            checkoutDisabled={false}
            context={null}
            onSend={async () => false}
            onStop={() => {}}
          />
        </section>
      ))}
      {open && (
        <Settings
          account={null}
          initialCategory="models"
          onClose={() => setOpen(false)}
          onDisconnect={async () => {}}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
