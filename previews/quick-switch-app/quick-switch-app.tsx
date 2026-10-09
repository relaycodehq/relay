// The real composer and Settings with quick-switch presets, on sample data.
// Open http://127.0.0.1:5177/previews/quick-switch-app/ (?settings to open Settings,
// &style=list|track|dock|tab to try another style)
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
import { parseQuickSwitch, setQuickSwitch } from "../../src/features/quick-switch/quick-switch";
import type { Api } from "../../shared/types";

initAppearance();

const params = new URLSearchParams(location.search);
setQuickSwitch(
  parseQuickSwitch({
    enabled: true,
    style: params.get("style") ?? "drum",
    presets: [
      { id: "a", provider: "claude", model: "claude-haiku-4-5-20251001", reasoningEffort: "low" },
      { id: "b", provider: "claude", model: "claude-sonnet-5", reasoningEffort: "medium" },
      { id: "c", provider: "claude", model: "claude-opus-5-5", reasoningEffort: "max" },
      { id: "d", provider: "codex", model: "gpt-6-luna", reasoningEffort: "medium" },
      { id: "e", provider: "codex", model: "gpt-6-astra", reasoningEffort: "xhigh", fast: true },
      { id: "f", provider: "opencode", model: "moonshot/kimi-k2", reasoningEffort: "" },
    ],
  }),
);
localStorage.setItem("composer-settings:new:qs", JSON.stringify({ agent: "claude" }));

let aiSettings: AISettings = defaultAISettings;
const stub = window.relay as Partial<Api>;
const agentModels = stub.agentModels!;
Object.assign(stub, {
  aiSettings: async () => aiSettings,
  saveAISettings: async (next: AISettings) => (aiSettings = next),
  updateState: async () => ({ status: "off", current: "preview" }),
  agentDefaults: async () => null,
  agentModels: (async (provider: string) =>
    provider === "opencode"
      ? [
          { id: "moonshot/kimi-k2", name: "Kimi K2", description: "", efforts: [], group: "Moonshot" },
          { id: "qwen/qwen3-coder", name: "Qwen3 Coder", description: "", efforts: [], group: "Qwen" },
        ]
      : agentModels(provider as never)) as Api["agentModels"],
});

const queryClient = new QueryClient();

function Preview() {
  const [open, setOpen] = useState(params.has("settings"));
  return (
    <div className="project-chat" style={{ padding: "260px 32px 32px", maxWidth: 820 }}>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Sample data · ⌘⌥←/→ in the composer ·{" "}
        <button type="button" onClick={() => setOpen(true)}>
          Open settings
        </button>
      </p>
      <ProjectComposer
        projectId="qs"
        keys={{ draft: "preview-draft:qs", settings: "new:qs" }}
        conversation={{ running: false, busy: false }}
        context={<ProjectBranchPicker projectId="qs" disabled={false} />}
        onSend={async () => false}
        onStop={() => {}}
        onCommand={() => false}
      />
      {open && (
        <Settings
          account={null}
          initialCategory="quick-switch"
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
