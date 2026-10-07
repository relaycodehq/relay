// The default agent setting and the new-thread composers that follow it.
// Open http://127.0.0.1:5177/previews/default-agent/
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../_shared/app-styles";
import { initAppearance } from "../../src/lib/appearance";
import { Settings } from "../../src/features/settings/Settings";
import { ProjectBranchPicker } from "../../src/features/changes/ProjectBranchPicker";
import { ProjectComposer } from "../../src/features/composer/ProjectComposer";
import { defaultAISettings, type AISettings } from "../../shared/settings";
import type { Api } from "../../shared/types";

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
  agentDefaults: async () => null,
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
            projectId={id}
            keys={{ draft: `preview-draft:${id}`, settings: `new:${id}` }}
            conversation={{ running: false, busy: false }}
            context={<ProjectBranchPicker projectId={id} disabled={false} />}
            onSend={async () => false}
            onStop={() => {}}
            onCommand={() => false}
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
